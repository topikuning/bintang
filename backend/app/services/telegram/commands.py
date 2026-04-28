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
        "<b>Bintang Bot</b> — perintah:\n"
        "<b>Lihat data:</b>\n"
        "  /saldo — saldo semua proyek\n"
        "  /saldo <kode> — saldo + budget proyek\n"
        "  /proyek — list proyek\n"
        "  /pending — transaksi belum diverifikasi (admin)\n"
        "  /invoice — invoice belum lunas\n"
        "\n<b>Catat transaksi (DRAFT):</b>\n"
        "  /keluar &lt;kode&gt; &lt;jumlah&gt; &lt;deskripsi&gt;\n"
        "  /masuk &lt;kode&gt; &lt;jumlah&gt; &lt;deskripsi&gt;\n"
        "  Contoh: <code>/keluar PRJ-001 5000000 Beli semen 50 sak</code>\n"
        "  Foto yang dikirim setelahnya jadi attachment otomatis.\n"
        "\n<b>Akun:</b>\n"
        "  /link <code>123456</code> — hubungkan akun web\n"
        "  /unlink — putuskan akun\n"
    )


async def cmd_start(db, user, chat_id, args, msg) -> str:
    if user:
        return (
            f"Selamat datang kembali, <b>{user.name}</b>.\n"
            "Akun ini sudah ter-link. Ketik /help untuk daftar perintah."
        )
    return (
        "Halo! Bot ini terhubung ke aplikasi <b>Bintang</b>.\n"
        "Untuk pakai, kamu harus link akun web dulu:\n"
        "1. Buka aplikasi web → menu <b>Profil</b> → <b>Hubungkan Telegram</b>.\n"
        "2. Salin kode 6 digit yang muncul.\n"
        "3. Kirim ke bot: <code>/link 123456</code>\n"
    )


async def cmd_link(db, user, chat_id, args, msg) -> str:
    if user:
        return f"Akun ini sudah ter-link sebagai <b>{user.name}</b>. Pakai /unlink dulu kalau mau ganti."
    if not args:
        return "Cara pakai: <code>/link 123456</code> (kode 6 digit dari halaman Profil web)."
    code = args[0].strip()
    linked = await consume_code(db, code, chat_id)
    if not linked:
        return "Kode tidak ditemukan / sudah kadaluwarsa. Generate kode baru dari web."
    return (
        f"✅ Berhasil! Akun ini terhubung ke <b>{linked.name}</b> ({linked.email}).\n"
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
        lines.append(f"• <code>{p.code}</code> — {p.name} <i>({p.status.value})</i>")
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
            f"<b>{proj.name}</b> ({proj.code})\n"
            f"Masuk: Rp {_fmt_idr(totals['total_in'])}\n"
            f"Keluar: Rp {_fmt_idr(totals['total_out'])}\n"
            f"Saldo: <b>Rp {_fmt_idr(totals['balance'])}</b>\n"
            f"Budget: Rp {_fmt_idr(bs['spent'])} / Rp {_fmt_idr(bs['budget_amount'])} "
            f"({float(bs['usage_pct']):.1f}% — {bs['status']})"
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
        lines.append(
            f"• #{t.id} <code>{code}</code> {sym}Rp {_fmt_idr(t.amount)} — "
            f"{(t.description or t.party_name or 'Transaksi')[:40]}"
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
            f"• {inv.number} <code>{code}</code> sisa <b>Rp {_fmt_idr(outstanding)}</b> "
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
        f"<b>{proj.code}</b> {sym}Rp {_fmt_idr(amount)} — {description or '(tanpa deskripsi)'}\n"
        f"<i>Kirim foto bukti (boleh beberapa) dalam {ATTACH_WINDOW_MINUTES} menit ke depan,\n"
        f"otomatis dilampirkan ke transaksi ini.</i>\n"
        "Submit untuk verifikasi lewat web."
    )


async def cmd_keluar(db, user, chat_id, args, msg) -> str:
    return await _make_transaction(db, user, chat_id, args, TxnType.OUT, msg)


async def cmd_masuk(db, user, chat_id, args, msg) -> str:
    return await _make_transaction(db, user, chat_id, args, TxnType.IN, msg)


# ---------------------------------------------------------------------------
# Photo handler — attach ke transaksi pending terbaru milik chat ini
# ---------------------------------------------------------------------------

async def handle_photo(db, user, chat_id, file_id: str, caption: str | None) -> str:
    """Download foto dari Telegram, simpan, dan attach ke transaksi pending."""
    if not user:
        return ""  # tidak balas spam ke user yg belum link
    # cari pending terakhir milik chat ini yang belum kadaluwarsa
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
            "Foto diterima tapi belum ada transaksi yang menunggu lampiran.\n"
            "Buat transaksi dulu lewat /keluar atau /masuk, lalu kirim foto."
        )
    payload = await tg.download_file(file_id)
    if not payload:
        return "Gagal download foto dari Telegram. Coba lagi."
    content, file_path = payload
    name = file_path.split("/")[-1] or f"telegram-{file_id}.jpg"
    ext = name.rsplit(".", 1)[-1] if "." in name else "jpg"
    # save_bytes: simpan ke uploads dengan optimasi gambar yg sudah ada
    meta = await save_bytes(
        content,
        original_name=name,
        subdir=f"transactions/{pending.transaction_id}",
        mime_hint=f"image/{'jpeg' if ext.lower() in ('jpg','jpeg') else ext.lower()}",
    )
    att = TransactionAttachment(
        transaction_id=pending.transaction_id,
        uploaded_by_id=user.id,
        **meta,
    )
    db.add(att)
    return f"📎 Foto dilampirkan ke transaksi #{pending.transaction_id}."


# ---------------------------------------------------------------------------
# Dispatcher
# ---------------------------------------------------------------------------

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
