"""Dispatcher command bot Telegram.

Setiap handler menerima `(db, user, chat_id, args, message)` dan
mengembalikan teks balasan (HTML). Foto yang dikirim setelah command
`/keluar` atau `/masuk` di-attach ke transaksi terakhir lewat tabel
`telegram_pending_attachments`.

RBAC ditegakkan: user yang belum link tidak boleh apa-apa selain
`/start`, `/link`, dan `/help`. Setelah link, scope project
mengikuti aturan biasa (project_users + scope_all_projects untuk
SUPERADMIN/CENTRAL_ADMIN).
"""
from __future__ import annotations

import html
import logging
from datetime import datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation
from typing import Awaitable, Callable

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import user_project_ids
from app.models.models import (
    Invoice,
    InvoiceAllocation,
    InvoiceStatus,
    PaymentMethod,
    Project,
    Transaction,
    TransactionAttachment,
    TelegramPendingCommand,
    TxnStatus,
    TxnType,
    User,
    UserRole,
)
from app.services.budget import budget_status, project_totals
from app.services.storage.local import save_bytes
from app.services.telegram import client as tg
from app.services.telegram.linking import consume_code

logger = logging.getLogger(__name__)

ATTACH_WINDOW_MINUTES = 5

CommandHandler = Callable[
    [AsyncSession, "User | None", str, list[str], dict],
    Awaitable[str],
]


def _fmt_idr(n) -> str:
    n = float(n or 0)
    s = f"{n:,.0f}"
    return s.replace(",", ".")


def _esc(s) -> str:
    """Escape teks user-provided agar aman dipakai di parse_mode=HTML."""
    if s is None:
        return ""
    return html.escape(str(s), quote=False)


def _is_admin(user: User) -> bool:
    return user.role in (UserRole.SUPERADMIN, UserRole.CENTRAL_ADMIN)


def _has_global_access(user: User) -> bool:
    if user.role in (UserRole.SUPERADMIN, UserRole.CENTRAL_ADMIN):
        return True
    if user.role == UserRole.EXECUTIVE and user.scope_all_projects:
        return True
    return False


# ---------------------------------------------------------------------------
# Read commands
# ---------------------------------------------------------------------------

async def cmd_help(db, user, chat_id, args, msg) -> str:
    return (
        "<b>CACAK Bot</b> — perintah:\n"
        "<b>Lihat data:</b>\n"
        "  /saldo — saldo semua proyek\n"
        "  /saldo &lt;kode&gt; — saldo + budget proyek\n"
        "  /proyek — list proyek\n"
        "  /pending — transaksi belum diverifikasi (admin)\n"
        "  /invoice — invoice belum lunas\n"
        "  /draft — daftar tx draft milik Anda\n"
        "  /lihat &lt;id&gt; — detail satu transaksi\n"
        "\n<b>Catat transaksi (DRAFT):</b>\n"
        "  /keluar &lt;kode&gt; &lt;jumlah&gt; &lt;deskripsi&gt;\n"
        "  /masuk &lt;kode&gt; &lt;jumlah&gt; &lt;deskripsi&gt;\n"
        "  Contoh: <code>/keluar PRJ-001 5000000 Beli semen 50 sak</code>\n"
        "  Catatan non-proyek: pakai kode Catatan Non-Proyek perusahaan "
        "(setel kode pendek di master Perusahaan → Kode Catatan Non-Proyek).\n"
        "  Foto yang dikirim setelahnya jadi attachment otomatis.\n"
        "\n<b>Workflow validasi:</b>\n"
        "  /submit &lt;id&gt; — kirim tx draft utk validasi\n"
        "  /verify &lt;id&gt; — admin verify tx submitted\n"
        "  /tolak &lt;id&gt; &lt;alasan&gt; — admin reject tx\n"
        "  /batal &lt;id&gt; &lt;alasan&gt; — cancel tx\n"
        "\n<b>Lampirkan bukti ke transaksi yang sudah ada:</b>\n"
        "  /buktitx &lt;id&gt; — buka jendela 5 menit utk attach foto/PDF\n"
        "  Contoh: <code>/buktitx 123</code> lalu kirim foto/file.\n"
        "\n<b>Akun:</b>\n"
        "  /link &lt;kode&gt; — hubungkan akun web (kode 6 digit dari menu Pengaturan)\n"
        "  /unlink — putuskan akun\n"
    )


async def cmd_start(db, user, chat_id, args, msg) -> str:
    if user:
        return (
            f"Selamat datang kembali, <b>{_esc(user.name)}</b>.\n"
            "Akun ini sudah ter-link. Ketik /help untuk daftar perintah."
        )
    return (
        "Halo! Bot ini terhubung ke aplikasi <b>CACAK</b>.\n"
        "Untuk pakai, kamu harus link akun web dulu:\n"
        "1. Buka aplikasi web → menu <b>Profil</b> → <b>Hubungkan Telegram</b>.\n"
        "2. Salin kode 6 digit yang muncul.\n"
        "3. Kirim ke bot: <code>/link 123456</code>\n"
    )


async def cmd_link(db, user, chat_id, args, msg) -> str:
    if user:
        return f"Akun ini sudah ter-link sebagai <b>{_esc(user.name)}</b>. Pakai /unlink dulu kalau mau ganti."
    if not args:
        return "Cara pakai: <code>/link 123456</code> (kode 6 digit dari halaman Profil web)."
    code = args[0].strip()
    linked = await consume_code(db, code, chat_id)
    if not linked:
        return "Kode tidak ditemukan / sudah kadaluwarsa. Generate kode baru dari web."
    return (
        f"✅ Berhasil! Akun ini terhubung ke <b>{_esc(linked.name)}</b> "
        f"({_esc(linked.email)}).\n"
        "Ketik /help untuk daftar perintah."
    )


async def cmd_unlink(db, user, chat_id, args, msg) -> str:
    if not user:
        return "Akun ini belum ter-link."
    user.telegram_chat_id = None
    return "Akun di-unlink. Sampai jumpa 👋"


async def _accessible_projects(db, user) -> list[Project]:
    pids = await user_project_ids(db, user)
    q = select(Project).where(Project.deleted_at.is_(None)).order_by(Project.code)
    if pids is not None:
        if not pids:
            return []
        q = q.where(Project.id.in_(pids))
    return list((await db.execute(q)).scalars().all())


async def cmd_proyek(db, user, chat_id, args, msg) -> str:
    if not user:
        return "Akun belum ter-link. Kirim /link &lt;kode&gt;."
    projects = await _accessible_projects(db, user)
    if not projects:
        return "Tidak ada proyek yang bisa diakses."
    lines = ["<b>Proyek kamu:</b>"]
    for p in projects[:30]:
        lines.append(
            f"• <code>{_esc(p.code)}</code> — {_esc(p.name)} <i>({p.status.value})</i>"
        )
    if len(projects) > 30:
        lines.append(f"\n…dan {len(projects)-30} lagi.")
    return "\n".join(lines)


async def cmd_saldo(db, user, chat_id, args, msg) -> str:
    if not user:
        return "Akun belum ter-link."
    if args:
        code = args[0].upper()
        proj = (await db.execute(
            select(Project).where(Project.code == code, Project.deleted_at.is_(None))
        )).scalar_one_or_none()
        if not proj:
            return f"Proyek dengan kode <code>{code}</code> tidak ditemukan."
        # akses
        accessible = await _accessible_projects(db, user)
        if proj.id not in {p.id for p in accessible}:
            return "Kamu tidak punya akses ke proyek ini."
        totals = await project_totals(db, proj.id)
        bs = budget_status(proj, totals["total_out"])
        return (
            f"<b>{_esc(proj.name)}</b> ({_esc(proj.code)})\n"
            f"Masuk: Rp {_fmt_idr(totals['total_in'])}\n"
            f"Keluar: Rp {_fmt_idr(totals['total_out'])}\n"
            f"Saldo: <b>Rp {_fmt_idr(totals['balance'])}</b>\n"
            f"Budget: Rp {_fmt_idr(bs['spent'])} / Rp {_fmt_idr(bs['budget_amount'])} "
            f"({float(bs['usage_pct']):.1f}% — {_esc(bs['status'])})"
        )
    # global
    projects = await _accessible_projects(db, user)
    if not projects:
        return "Tidak ada proyek yang bisa diakses."
    total_in = total_out = Decimal("0")
    for p in projects:
        t = await project_totals(db, p.id)
        total_in += Decimal(t["total_in"])
        total_out += Decimal(t["total_out"])
    balance = total_in - total_out
    return (
        f"<b>Saldo Konsolidasi</b> ({len(projects)} proyek)\n"
        f"Masuk: Rp {_fmt_idr(total_in)}\n"
        f"Keluar: Rp {_fmt_idr(total_out)}\n"
        f"Saldo: <b>Rp {_fmt_idr(balance)}</b>\n"
        "\nDetail per proyek: <code>/saldo PRJ-001</code>"
    )


async def cmd_pending(db, user, chat_id, args, msg) -> str:
    if not user:
        return "Akun belum ter-link."
    if not _is_admin(user):
        return "Hanya admin yang bisa lihat list pending verifikasi."
    pids = await user_project_ids(db, user)
    q = (
        select(Transaction, Project.code)
        .join(Project, Project.id == Transaction.project_id)
        .where(
            Transaction.status == TxnStatus.SUBMITTED,
            Transaction.deleted_at.is_(None),
        )
        .order_by(Transaction.tx_date.desc())
        .limit(20)
    )
    if pids is not None:
        if not pids:
            return "Tidak ada akses."
        q = q.where(Transaction.project_id.in_(pids))
    rows = (await db.execute(q)).all()
    if not rows:
        return "Tidak ada transaksi pending."
    lines = [f"<b>{len(rows)} transaksi menunggu verifikasi:</b>"]
    for t, code in rows:
        sym = "−" if t.type == TxnType.OUT else "+"
        desc = (t.description or t.party_name or "Transaksi")[:40]
        lines.append(
            f"• #{t.id} <code>{_esc(code)}</code> {sym}Rp {_fmt_idr(t.amount)} — "
            f"{_esc(desc)}"
        )
    return "\n".join(lines)


async def cmd_invoice(db, user, chat_id, args, msg) -> str:
    if not user:
        return "Akun belum ter-link."
    pids = await user_project_ids(db, user)
    paid_sub = (
        select(
            InvoiceAllocation.invoice_id.label("inv_id"),
            func.coalesce(func.sum(InvoiceAllocation.allocated_amount), 0).label("paid"),
        )
        .where(InvoiceAllocation.deleted_at.is_(None))
        .group_by(InvoiceAllocation.invoice_id)
        .subquery()
    )
    q = (
        select(Invoice, Project.code, func.coalesce(paid_sub.c.paid, 0))
        .join(Project, Project.id == Invoice.project_id)
        .outerjoin(paid_sub, paid_sub.c.inv_id == Invoice.id)
        .where(
            Invoice.status.in_([InvoiceStatus.ISSUED, InvoiceStatus.PARTIALLY_PAID, InvoiceStatus.OVERDUE]),
            Invoice.deleted_at.is_(None),
        )
        .order_by(Invoice.due_date.asc().nulls_last(), Invoice.id.desc())
        .limit(20)
    )
    if pids is not None:
        if not pids:
            return "Tidak ada akses."
        q = q.where(Invoice.project_id.in_(pids))
    rows = (await db.execute(q)).all()
    if not rows:
        return "Tidak ada invoice belum lunas."
    lines = ["<b>Invoice belum lunas:</b>"]
    for inv, code, paid in rows:
        outstanding = float(inv.total or 0) - float(paid or 0)
        due = inv.due_date.isoformat() if inv.due_date else "-"
        lines.append(
            f"• {_esc(inv.number)} <code>{_esc(code)}</code> sisa "
            f"<b>Rp {_fmt_idr(outstanding)}</b> "
            f"({inv.status.value}, jatuh tempo {due})"
        )
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Write commands
# ---------------------------------------------------------------------------

def _parse_amount(token: str) -> Decimal:
    s = token.strip().replace("Rp", "").replace("rp", "").replace(" ", "")
    if "," in s and "." in s:
        if s.rfind(",") > s.rfind("."):
            s = s.replace(".", "").replace(",", ".")
        else:
            s = s.replace(",", "")
    elif "," in s:
        if s.count(",") == 1 and len(s.split(",")[1]) <= 2:
            s = s.replace(",", ".")
        else:
            s = s.replace(",", "")
    elif "." in s:
        # treat dots as thousands separator (Indonesian)
        if s.count(".") >= 1 and all(len(p) == 3 for p in s.split(".")[1:]):
            s = s.replace(".", "")
    return Decimal(s)


async def _make_transaction(
    db, user, chat_id, args, ttype: TxnType, msg: dict
) -> str:
    if not user:
        return "Akun belum ter-link."
    if user.role == UserRole.EXECUTIVE:
        return "Role EXECUTIVE tidak bisa membuat transaksi."
    if len(args) < 3:
        return (
            f"Cara pakai: <code>/{'keluar' if ttype==TxnType.OUT else 'masuk'} "
            "PRJ-001 5000000 deskripsi singkat</code>"
        )
    code = args[0].upper()
    proj = (await db.execute(
        select(Project).where(Project.code == code, Project.deleted_at.is_(None))
    )).scalar_one_or_none()
    if not proj:
        return f"Proyek <code>{code}</code> tidak ditemukan."
    accessible = await _accessible_projects(db, user)
    if proj.id not in {p.id for p in accessible}:
        return "Kamu tidak punya akses ke proyek ini."
    try:
        amount = _parse_amount(args[1])
    except (InvalidOperation, ValueError):
        return f"Jumlah tidak valid: <code>{args[1]}</code>"
    if amount <= 0:
        return "Jumlah harus &gt; 0."
    description = " ".join(args[2:]).strip() or None
    tx = Transaction(
        project_id=proj.id,
        tx_date=datetime.now(timezone.utc).date(),
        type=ttype,
        amount=amount,
        description=description,
        party_name=description,
        payment_method=PaymentMethod.TRANSFER,
        status=TxnStatus.DRAFT,
        created_by_id=user.id,
    )
    db.add(tx)
    await db.flush()
    # daftarkan ke pending attachment buffer agar foto next 5 menit nyangkut
    pa = TelegramPendingCommand(
        chat_id=str(chat_id),
        transaction_id=tx.id,
        expires_at=datetime.now(timezone.utc) + timedelta(minutes=ATTACH_WINDOW_MINUTES),
    )
    db.add(pa)
    sym = "−" if ttype == TxnType.OUT else "+"
    return (
        f"✅ Transaksi DRAFT #{tx.id} dibuat\n"
        f"<b>{_esc(proj.code)}</b> {sym}Rp {_fmt_idr(amount)} — "
        f"{_esc(description or '(tanpa deskripsi)')}\n"
        f"<i>Kirim foto bukti (boleh beberapa) dalam {ATTACH_WINDOW_MINUTES} menit ke depan,\n"
        f"otomatis dilampirkan ke transaksi ini.</i>\n"
        "Submit untuk verifikasi lewat web."
    )


async def cmd_keluar(db, user, chat_id, args, msg) -> str:
    return await _make_transaction(db, user, chat_id, args, TxnType.OUT, msg)


async def cmd_masuk(db, user, chat_id, args, msg) -> str:
    return await _make_transaction(db, user, chat_id, args, TxnType.IN, msg)


async def cmd_buktitx(db, user, chat_id, args, msg) -> str:
    """Buka jendela attach untuk transaksi yang SUDAH ada.
    Cara pakai: /buktitx <id transaksi>. Setelah itu, semua foto/file
    yang dikirim dalam 5 menit akan di-lampirkan ke transaksi tsb.
    """
    if not user:
        return "Akun belum ter-link."
    if not args:
        return (
            "Cara pakai: <code>/buktitx 123</code>\n"
            "(<i>123</i> = nomor/ID transaksi yang mau dilampiri bukti)"
        )
    try:
        tid = int(args[0])
    except ValueError:
        return f"Nomor transaksi tidak valid: <code>{_esc(args[0])}</code>"
    tx = await db.get(Transaction, tid)
    if not tx or tx.deleted_at is not None:
        return f"Transaksi #{tid} tidak ditemukan."
    accessible = await _accessible_projects(db, user)
    if tx.project_id not in {p.id for p in accessible}:
        return "Kamu tidak punya akses ke transaksi ini."
    proj = await db.get(Project, tx.project_id)
    pa = TelegramPendingCommand(
        chat_id=str(chat_id),
        transaction_id=tid,
        expires_at=datetime.now(timezone.utc) + timedelta(minutes=ATTACH_WINDOW_MINUTES),
    )
    db.add(pa)
    sym = "−" if tx.type == TxnType.OUT else "+"
    return (
        f"📎 Siap menerima bukti untuk transaksi <b>#{tid}</b>\n"
        f"<code>{_esc(proj.code if proj else '-')}</code> "
        f"{sym}Rp {_fmt_idr(tx.amount)} — "
        f"<i>{_esc((tx.description or tx.party_name or '')[:60])}</i>\n"
        f"Kirim foto / file (PDF) dalam <b>{ATTACH_WINDOW_MINUTES} menit</b> ke depan."
    )


# ---------------------------------------------------------------------------
# Photo handler — attach ke transaksi pending terbaru milik chat ini
# ---------------------------------------------------------------------------

async def handle_photo(
    db,
    user,
    chat_id,
    file_id: str,
    caption: str | None,
    file_name: str | None = None,
) -> str:
    """Download lampiran (foto/PDF/video) dari Telegram, simpan, attach
    ke transaksi pending terbaru milik chat ini.
    """
    if not user:
        return ""
    now = datetime.now(timezone.utc)
    q = (
        select(TelegramPendingCommand)
        .where(
            TelegramPendingCommand.chat_id == str(chat_id),
            TelegramPendingCommand.expires_at > now,
        )
        .order_by(TelegramPendingCommand.id.desc())
        .limit(1)
    )
    pending = (await db.execute(q)).scalar_one_or_none()
    if not pending:
        return (
            "Lampiran diterima tapi belum ada transaksi yang menunggu.\n"
            "Buat transaksi dulu (/keluar atau /masuk), atau buka jendela "
            "lampiran utk transaksi yg sudah ada dgn /buktitx &lt;id&gt;."
        )
    payload = await tg.download_file(file_id)
    if not payload:
        return "Gagal download lampiran dari Telegram. Coba lagi."
    content, file_path = payload
    name = file_name or file_path.split("/")[-1] or f"telegram-{file_id}.bin"
    ext = name.rsplit(".", 1)[-1].lower() if "." in name else ""
    # Tebak mime dari ekstensi; fallback ke jpeg utk foto tanpa ekstensi
    mime = None
    if ext in ("jpg", "jpeg"):
        mime = "image/jpeg"
    elif ext == "png":
        mime = "image/png"
    elif ext == "webp":
        mime = "image/webp"
    elif ext == "pdf":
        mime = "application/pdf"
    elif ext in ("mp4", "mov"):
        mime = "video/mp4"
    elif not ext:
        # Foto Telegram biasanya tanpa ekstensi -> jpeg
        name = name + ".jpg"
        mime = "image/jpeg"
    meta = await save_bytes(
        content,
        original_name=name,
        subdir=f"transactions/{pending.transaction_id}",
        mime_hint=mime,
    )
    att = TransactionAttachment(
        transaction_id=pending.transaction_id,
        uploaded_by_id=user.id,
        **meta,
    )
    db.add(att)
    return f"📎 Lampiran disimpan ke transaksi #{pending.transaction_id}."


# ---------------------------------------------------------------------------
# Dispatcher
# ---------------------------------------------------------------------------

# Wrapper utk command workflow dari chat_workflow module -- adapter
# signature (db, user, chat_id, args, msg) -> (db, user, args).
def _wrap_workflow(fn):
    async def _h(db, user, chat_id, args, msg) -> str:
        if not user:
            return "Akun belum ter-link. Ketik /link &lt;kode&gt; dulu."
        return await fn(db, user, args)
    return _h


from app.services import chat_workflow as _wf  # noqa: E402


REGISTRY: dict[str, CommandHandler] = {
    "start": cmd_start,
    "help": cmd_help,
    "link": cmd_link,
    "unlink": cmd_unlink,
    "saldo": cmd_saldo,
    "proyek": cmd_proyek,
    "projek": cmd_proyek,           # typo-tolerant alias
    "pending": cmd_pending,
    "invoice": cmd_invoice,
    "keluar": cmd_keluar,
    "out": cmd_keluar,
    "masuk": cmd_masuk,
    "in": cmd_masuk,
    "buktitx": cmd_buktitx,
    "bukti": cmd_buktitx,           # alias
    "lampiran": cmd_buktitx,        # alias
    # --- Workflow validasi (PR perintah lengkap) ---
    "submit": _wrap_workflow(_wf.cmd_submit),
    "kirim": _wrap_workflow(_wf.cmd_submit),     # alias ID
    "verify": _wrap_workflow(_wf.cmd_verify),
    "verifikasi": _wrap_workflow(_wf.cmd_verify),
    "validasi": _wrap_workflow(_wf.cmd_verify),
    "tolak": _wrap_workflow(_wf.cmd_reject),
    "reject": _wrap_workflow(_wf.cmd_reject),
    "batal": _wrap_workflow(_wf.cmd_cancel),
    "cancel": _wrap_workflow(_wf.cmd_cancel),
    "lihat": _wrap_workflow(_wf.cmd_lihat),
    "detail": _wrap_workflow(_wf.cmd_lihat),
    "draft": _wrap_workflow(_wf.cmd_draft),
}


def parse_command(text: str) -> tuple[str, list[str]] | None:
    """Pisahkan '/cmd@bot arg1 arg2' jadi ('cmd', ['arg1', 'arg2']).
    Tidak quoted-aware (deskripsi multi-kata di-join lagi di handler)."""
    if not text or not text.startswith("/"):
        return None
    body = text[1:].strip()
    if not body:
        return None
    # buang @botname
    head, _, rest = body.partition(" ")
    name = head.split("@", 1)[0].lower()
    args = rest.split() if rest else []
    return name, args


async def dispatch_command(
    db, user: User | None, chat_id: str, text: str, message: dict
) -> str:
    parsed = parse_command(text)
    if not parsed:
        return ""
    name, args = parsed
    handler = REGISTRY.get(name)
    if not handler:
        return f"Perintah <code>/{name}</code> tidak dikenal. Ketik /help."
    try:
        return await handler(db, user, chat_id, args, message)
    except Exception as e:
        logger.exception("telegram command handler failed")
        return f"⚠️ Terjadi error: {e}"
