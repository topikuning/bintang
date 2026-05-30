"""Dispatcher command bot WhatsApp via WAHA.

Sama polanya dengan telegram/commands.py: command `/keluar`, `/masuk`, dst
mengembalikan teks balasan, foto yang dikirim setelahnya di-attach via
buffer pending. Format teks pakai gaya Markdown WhatsApp:
*bold*, _italic_, ```mono```.
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
    TxnStatus,
    TxnType,
    User,
    UserRole,
    WhatsAppPendingCommand,
)
from app.services.budget import budget_status, project_totals
from app.services.storage.local import save_bytes
from app.services.whatsapp import client as wa
from app.services.whatsapp.linking import consume_code

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


# ---------------------------------------------------------------------------
# Read commands
# ---------------------------------------------------------------------------

async def cmd_help(db, user, chat_id, args, msg) -> str:
    return (
        "*Bintang Bot* — perintah:\n"
        "*Lihat data:*\n"
        "  /saldo — saldo semua proyek\n"
        "  /saldo <kode> — saldo + budget proyek\n"
        "  /proyek — list proyek\n"
        "  /pending — transaksi belum diverifikasi (admin)\n"
        "  /invoice — invoice belum lunas\n"
        "  /draft — daftar tx draft milik Anda\n"
        "  /lihat <id> — detail satu transaksi\n"
        "\n*Catat transaksi (DRAFT):*\n"
        "  /keluar <kode> <jumlah> <deskripsi>\n"
        "  /masuk <kode> <jumlah> <deskripsi>\n"
        "  Contoh: ```/keluar PRJ-001 5000000 Beli semen 50 sak```\n"
        "  Catatan non-proyek: pakai kode Catatan Non-Proyek perusahaan "
        "(setel kode pendek di master Perusahaan).\n"
        "  Foto yang dikirim setelahnya jadi attachment otomatis.\n"
        "\n*Workflow validasi:*\n"
        "  /submit <id> — kirim tx draft utk validasi\n"
        "  /verify <id> — admin verify tx submitted\n"
        "  /tolak <id> <alasan> — admin reject tx\n"
        "  /batal <id> <alasan> — cancel tx\n"
        "\n*Lampirkan bukti ke transaksi yang sudah ada:*\n"
        "  /buktitx <id> — buka jendela 5 menit utk attach foto/PDF\n"
        "  Contoh: ```/buktitx 123``` lalu kirim foto/file.\n"
        "\n*Buat PO via chat (AI parser):*\n"
        "  /po — kirim daftar item + proyek + vendor; AI parse → preview → balas *ya*\n"
        "  Contoh:\n"
        "```\n/po\n"
        "Besi 10 polos = 270 lonjor\n"
        "Wiremesh M8 bulat = 228 lembar\n"
        "proyek BMJ1\n"
        "vendor PT Sumber Besi```\n"
        "\n*AI (admin):*\n"
        "  /tanya <pertanyaan> — tanya laporan natural\n"
        "  Contoh: ```/tanya top vendor bulan ini```\n"
        "  /ringkas — ringkasan executive hari ini\n"
        "\n*Akun:*\n"
        "  /link <kode> — hubungkan akun web (kode 6 digit dari menu Pengaturan)\n"
        "  /unlink — putuskan akun\n"
    )


async def cmd_start(db, user, chat_id, args, msg) -> str:
    if user:
        return (
            f"Selamat datang kembali, *{user.name}*.\n"
            "Akun ini sudah ter-link. Ketik /help untuk daftar perintah."
        )
    return (
        "Halo! Bot ini terhubung ke aplikasi *Bintang*.\n"
        "Untuk pakai, kamu harus link akun web dulu:\n"
        "1. Buka aplikasi web → menu *Pengaturan* → *Hubungkan WhatsApp*.\n"
        "2. Salin kode 6 digit yang muncul.\n"
        "3. Kirim ke bot: ```/link 123456```\n"
    )


async def cmd_link(db, user, chat_id, args, msg) -> str:
    if user:
        return f"Akun ini sudah ter-link sebagai *{user.name}*. Pakai /unlink dulu kalau mau ganti."
    if not args:
        return "Cara pakai: ```/link 123456``` (kode 6 digit dari halaman Pengaturan web)."
    code = args[0].strip()
    linked = await consume_code(db, code, chat_id)
    if not linked:
        return "Kode tidak ditemukan / sudah kadaluwarsa. Generate kode baru dari web."
    return (
        f"✅ Berhasil! Akun ini terhubung ke *{linked.name}* "
        f"({linked.email}).\n"
        "Ketik /help untuk daftar perintah."
    )


async def cmd_unlink(db, user, chat_id, args, msg) -> str:
    if not user:
        return "Akun ini belum ter-link."
    user.whatsapp_chat_id = None
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
        return "Akun belum ter-link. Kirim /link <kode>."
    projects = await _accessible_projects(db, user)
    if not projects:
        return "Tidak ada proyek yang bisa diakses."
    lines = ["*Proyek kamu:*"]
    for p in projects[:30]:
        lines.append(f"• `{p.code}` — {p.name} _({p.status.value})_")
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
            return f"Proyek dengan kode `{code}` tidak ditemukan."
        accessible = await _accessible_projects(db, user)
        if proj.id not in {p.id for p in accessible}:
            return "Kamu tidak punya akses ke proyek ini."
        totals = await project_totals(db, proj.id)
        # Audit 2026-05-23: exclude marketing + bagi hasil dr budget bar.
        from app.services.budget import project_expense_breakdown
        exp_brk = await project_expense_breakdown(db, proj.id)
        bs = budget_status(
            proj, totals["total_out"],
            marketing_actual=exp_brk["marketing"],
            profit_share_actual=exp_brk["profit_share"],
        )
        return (
            f"*{proj.name}* ({proj.code})\n"
            f"Masuk: Rp {_fmt_idr(totals['total_in'])}\n"
            f"Keluar: Rp {_fmt_idr(totals['total_out'])}\n"
            f"Saldo: *Rp {_fmt_idr(totals['balance'])}*\n"
            f"Budget: Rp {_fmt_idr(bs['spent'])} / Rp {_fmt_idr(bs['budget_amount'])} "
            f"({float(bs['usage_pct']):.1f}% — {bs['status']})"
        )
    # Audit 2026-05-24: KONSISTEN dgn dashboard -- exclude DIBATALKAN.
    # SELESAI tetap ikut (real money).
    from app.models.models import ProjectStatus as _PS
    projects = [
        p for p in await _accessible_projects(db, user)
        if p.status != _PS.DIBATALKAN
    ]
    if not projects:
        return "Tidak ada proyek yang bisa diakses."
    total_in = total_out = Decimal("0")
    for p in projects:
        t = await project_totals(db, p.id)
        total_in += Decimal(t["total_in"])
        total_out += Decimal(t["total_out"])
    balance = total_in - total_out
    return (
        f"*Saldo Konsolidasi* ({len(projects)} proyek)\n"
        f"Masuk: Rp {_fmt_idr(total_in)}\n"
        f"Keluar: Rp {_fmt_idr(total_out)}\n"
        f"Saldo: *Rp {_fmt_idr(balance)}*\n"
        "\nDetail per proyek: ```/saldo PRJ-001```"
    )


async def cmd_pending(db, user, chat_id, args, msg) -> str:
    if not user:
        return "Akun belum ter-link."
    if not _is_admin(user):
        return "Hanya admin yang bisa lihat list pending verifikasi."
    pids = await user_project_ids(db, user)
    # Audit 2026-05-24: KONSISTEN -- exclude SELESAI/DIBATALKAN.
    from app.services.project_guard import operational_project_ids
    op_pids = await operational_project_ids(db, pids)
    if not op_pids:
        return "Tidak ada transaksi pending."
    q = (
        select(Transaction, Project.code)
        .join(Project, Project.id == Transaction.project_id)
        .where(
            Transaction.status == TxnStatus.SUBMITTED,
            Transaction.deleted_at.is_(None),
            Transaction.project_id.in_(op_pids),
        )
        .order_by(Transaction.tx_date.desc())
        .limit(20)
    )
    rows = (await db.execute(q)).all()
    if not rows:
        return "Tidak ada transaksi pending."
    lines = [f"*{len(rows)} transaksi menunggu verifikasi:*"]
    for t, code in rows:
        sym = "−" if t.type == TxnType.OUT else "+"
        desc = (t.description or t.party_name or "Transaksi")[:40]
        lines.append(f"• #{t.id} `{code}` {sym}Rp {_fmt_idr(t.amount)} — {desc}")
    return "\n".join(lines)


async def cmd_invoice(db, user, chat_id, args, msg) -> str:
    if not user:
        return "Akun belum ter-link."
    pids = await user_project_ids(db, user)
    # Audit 2026-05-24: KONSISTEN -- exclude SELESAI (tagihan clear) +
    # DIBATALKAN (soft-deleted).
    from app.services.project_guard import operational_project_ids
    op_pids = await operational_project_ids(db, pids)
    if not op_pids:
        return "Tidak ada invoice belum lunas."
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
            Invoice.project_id.in_(op_pids),
        )
        .order_by(Invoice.due_date.asc().nulls_last(), Invoice.id.desc())
        .limit(20)
    )
    rows = (await db.execute(q)).all()
    if not rows:
        return "Tidak ada invoice belum lunas."
    lines = ["*Invoice belum lunas:*"]
    for inv, code, paid in rows:
        outstanding = float(inv.total or 0) - float(paid or 0)
        due = inv.due_date.isoformat() if inv.due_date else "-"
        lines.append(
            f"• {inv.number} `{code}` sisa *Rp {_fmt_idr(outstanding)}* "
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
            f"Cara pakai: ```/{'keluar' if ttype==TxnType.OUT else 'masuk'} "
            "PRJ-001 5000000 deskripsi singkat```"
        )
    code = args[0].upper()
    proj = (await db.execute(
        select(Project).where(Project.code == code, Project.deleted_at.is_(None))
    )).scalar_one_or_none()
    if not proj:
        return f"Proyek `{code}` tidak ditemukan."
    accessible = await _accessible_projects(db, user)
    if proj.id not in {p.id for p in accessible}:
        return "Kamu tidak punya akses ke proyek ini."
    try:
        amount = _parse_amount(args[1])
    except (InvalidOperation, ValueError):
        return f"Jumlah tidak valid: `{args[1]}`"
    if amount <= 0:
        return "Jumlah harus > 0."
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
    pa = WhatsAppPendingCommand(
        chat_id=str(chat_id),
        transaction_id=tx.id,
        expires_at=datetime.now(timezone.utc) + timedelta(minutes=ATTACH_WINDOW_MINUTES),
    )
    db.add(pa)
    sym = "−" if ttype == TxnType.OUT else "+"
    return (
        f"✅ Transaksi DRAFT #{tx.id} dibuat\n"
        f"*{proj.code}* {sym}Rp {_fmt_idr(amount)} — "
        f"{description or '(tanpa deskripsi)'}\n"
        f"_Kirim foto bukti (boleh beberapa) dalam {ATTACH_WINDOW_MINUTES} menit ke depan,\n"
        f"otomatis dilampirkan ke transaksi ini._\n"
        "Submit untuk verifikasi lewat web."
    )


async def cmd_keluar(db, user, chat_id, args, msg) -> str:
    return await _make_transaction(db, user, chat_id, args, TxnType.OUT, msg)


async def cmd_masuk(db, user, chat_id, args, msg) -> str:
    return await _make_transaction(db, user, chat_id, args, TxnType.IN, msg)


async def cmd_po(db, user, chat_id, args, msg) -> str:
    """Buat Purchase Order via teks chat (audit 2026-05-30).

    Cara pakai (1 pesan):
      /po
      Besi 10 polos = 270 lonjor
      proyek BMJ1
      vendor PT Sumber Besi

    Bot AI-parse, kirim preview, balas *ya* utk simpan DRAFT.
    """
    if not user:
        return "Akun belum ter-link. Pakai /link <kode> dulu."
    text = (msg or {}).get("text") or (msg or {}).get("caption") or ""
    if "\n" in text:
        body = text.split("\n", 1)[1].strip()
    else:
        body = " ".join(args).strip()
    if not body:
        return (
            "Format: */po* + daftar item per-baris, sebutkan proyek & vendor.\n\n"
            "Contoh:\n"
            "```\n/po\n"
            "Besi 10 polos = 270 lonjor\n"
            "Wiremesh M8 bulat = 228 lembar\n"
            "proyek BMJ1\n"
            "vendor PT Sumber Besi\n```"
        )
    from app.services.bot_po_assistant import BotPOError, parse_and_save
    try:
        return await parse_and_save(
            db, user=user, channel="whatsapp", chat_id=chat_id, text=body,
        )
    except BotPOError as e:
        return f"❌ {e}"
    except Exception as e:
        logger.exception("cmd_po parse failed (WA)")
        return f"⚠️ Gagal parse: {e}"


async def cmd_buktitx(db, user, chat_id, args, msg) -> str:
    """Buka jendela attach untuk transaksi yang SUDAH ada.
    Cara pakai: /buktitx <id transaksi>. Setelah itu, semua foto/file
    yang dikirim dalam 5 menit akan di-lampirkan ke transaksi tsb.
    """
    if not user:
        return "Akun belum ter-link."
    if not args:
        return (
            "Cara pakai: ```/buktitx 123```\n"
            "(_123_ = nomor/ID transaksi yang mau dilampiri bukti)"
        )
    try:
        tid = int(args[0])
    except ValueError:
        return f"Nomor transaksi tidak valid: `{args[0]}`"
    tx = await db.get(Transaction, tid)
    if not tx or tx.deleted_at is not None:
        return f"Transaksi #{tid} tidak ditemukan."
    accessible = await _accessible_projects(db, user)
    if tx.project_id not in {p.id for p in accessible}:
        return "Kamu tidak punya akses ke transaksi ini."
    proj = await db.get(Project, tx.project_id)
    pa = WhatsAppPendingCommand(
        chat_id=str(chat_id),
        transaction_id=tid,
        expires_at=datetime.now(timezone.utc) + timedelta(minutes=ATTACH_WINDOW_MINUTES),
    )
    db.add(pa)
    sym = "−" if tx.type == TxnType.OUT else "+"
    return (
        f"📎 Siap menerima bukti untuk transaksi *#{tid}*\n"
        f"`{proj.code if proj else '-'}` "
        f"{sym}Rp {_fmt_idr(tx.amount)} — "
        f"_{(tx.description or tx.party_name or '')[:60]}_\n"
        f"Kirim foto / file (PDF) dalam *{ATTACH_WINDOW_MINUTES} menit* ke depan."
    )


# ---------------------------------------------------------------------------
# Photo handler
# ---------------------------------------------------------------------------

async def handle_media(
    db,
    user,
    chat_id: str,
    media_url: str | None,
    mime: str | None,
    file_name: str | None,
    message_id: str | None = None,
) -> str:
    """Download media dari WAHA, simpan, attach ke transaksi pending terakhir.

    Coba dua strategi:
    1. Direct dari `media_url` (URL/path/data URI yg dikirim webhook).
    2. Fallback ke `/api/{session}/messages/{id}/download` kalau (1) gagal.
    """
    if not user:
        return ""
    now = datetime.now(timezone.utc)
    q = (
        select(WhatsAppPendingCommand)
        .where(
            WhatsAppPendingCommand.chat_id == str(chat_id),
            WhatsAppPendingCommand.expires_at > now,
        )
        .order_by(WhatsAppPendingCommand.id.desc())
        .limit(1)
    )
    pending = (await db.execute(q)).scalar_one_or_none()
    if not pending:
        return (
            "Lampiran diterima tapi belum ada transaksi yang menunggu.\n"
            "Buat transaksi dulu (/keluar atau /masuk), atau buka jendela "
            "lampiran utk transaksi yg sudah ada dgn /buktitx <id>."
        )

    content: bytes | None = None
    ct: str | None = None
    fname_hdr: str | None = None
    if media_url:
        payload = await wa.download_media(media_url)
        if payload:
            content, ct = payload

    if content is None and message_id:
        logger.info("whatsapp: fallback to messages/download for id=%s", message_id)
        payload2 = await wa.download_message_media(message_id)
        if payload2:
            content, ct, fname_hdr = payload2

    if content is None:
        logger.warning(
            "whatsapp handle_media gagal — media_url=%s message_id=%s",
            media_url, message_id,
        )
        return (
            "Gagal download foto dari WhatsApp. Pastikan WAHA dikonfigurasi "
            "dengan media auto-download aktif, lalu kirim ulang."
        )

    name = file_name or fname_hdr or f"whatsapp-{int(now.timestamp())}.jpg"
    final_mime = mime or ct or "image/jpeg"
    meta = await save_bytes(
        content,
        original_name=name,
        subdir=f"transactions/{pending.transaction_id}",
        mime_hint=final_mime,
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

# Wrapper utk command workflow dr chat_workflow -- adapter signature.
def _wrap_workflow(fn):
    async def _h(db, user, chat_id, args, msg) -> str:
        if not user:
            return "Akun belum ter-link. Ketik /link <kode> dulu."
        return await fn(db, user, args)
    return _h


from app.services import chat_workflow as _wf  # noqa: E402


# ============================================================
# AI commands (audit 2026-05-23). Implementasi sama dgn Telegram --
# format output pakai WhatsApp markdown (*bold*, _italic_) bukan HTML.
# ============================================================

async def cmd_tanya(db, user, chat_id, args, msg) -> str:
    """AI-6: tanya laporan natural language."""
    if not user:
        return "Akun belum ter-link. Kirim /link <kode>."
    if not args:
        return (
            "Cara pakai: /tanya <pertanyaan>\n"
            "Contoh:\n"
            "• /tanya berapa pengeluaran material bulan ini\n"
            "• /tanya top vendor minggu lalu\n"
            "• /tanya sisa hutang dan piutang sekarang"
        )
    question = " ".join(args).strip()
    try:
        from app.services.ai.features.ask_query import run as run_ask
        result = await run_ask(db, user=user, question=question)
        await db.commit()
    except Exception as e:  # noqa: BLE001
        return f"AI gagal: {str(e)[:200]}"

    if result.get("template") == "none":
        out = result.get("reason", "")
        fu = result.get("follow_up")
        if fu:
            out += f"\n\n💡 {fu}"
        return out

    data = result.get("data") or {}
    cols = data.get("columns", [])
    rows = data.get("data", [])
    if not rows:
        return "Tidak ada data utk pertanyaan ini."

    lines = [f"*{result.get('reason', '')}*", ""]
    lines.append(" · ".join(f"_{c}_" for c in cols))
    for row in rows[:10]:
        formatted = []
        for cell in row:
            if isinstance(cell, (int, float)):
                formatted.append(f"Rp {_fmt_idr(cell)}")
            else:
                formatted.append(str(cell))
        lines.append(" · ".join(formatted))
    if len(rows) > 10:
        lines.append(f"\n_... +{len(rows)-10} baris lagi (buka web)_")
    return "\n".join(lines)


async def cmd_ringkas(db, user, chat_id, args, msg) -> str:
    """AI-8: ringkasan executive hari ini. Admin only."""
    if not user:
        return "Akun belum ter-link. Kirim /link <kode>."
    if not _is_admin(user):
        return "Hanya SUPERADMIN/CENTRAL_ADMIN yg bisa pakai /ringkas."
    try:
        from app.services.ai.features.daily_summary import run as run_summary
        result = await run_summary(db, user_id=user.id, target_date=None)
        await db.commit()
    except Exception as e:  # noqa: BLE001
        return f"AI gagal: {str(e)[:200]}"
    text = result.get("text", "(no output)")
    return f"*📊 Ringkasan Hari Ini*\n\n{text}"


REGISTRY: dict[str, CommandHandler] = {
    "start": cmd_start,
    "help": cmd_help,
    "link": cmd_link,
    "unlink": cmd_unlink,
    "saldo": cmd_saldo,
    "proyek": cmd_proyek,
    "projek": cmd_proyek,
    "pending": cmd_pending,
    "invoice": cmd_invoice,
    "keluar": cmd_keluar,
    "out": cmd_keluar,
    "masuk": cmd_masuk,
    "in": cmd_masuk,
    "buktitx": cmd_buktitx,
    "bukti": cmd_buktitx,
    "lampiran": cmd_buktitx,
    "po": cmd_po,
    "buatpo": cmd_po,
    "buat-po": cmd_po,
    # --- Workflow validasi ---
    "submit": _wrap_workflow(_wf.cmd_submit),
    "kirim": _wrap_workflow(_wf.cmd_submit),
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
    # --- AI commands (audit 2026-05-23) ---
    "tanya": cmd_tanya,
    "ask": cmd_tanya,
    "ringkas": cmd_ringkas,
    "summary": cmd_ringkas,
}


def parse_command(text: str) -> tuple[str, list[str]] | None:
    """Audit 2026-05-30: support multi-line body (mis. `/po\\n<items>`).
    Head = chars sebelum whitespace pertama; rest = sisa (split by space
    utk args legacy). Handler yg butuh raw body multi-line baca
    message text langsung."""
    if not text or not text.startswith("/"):
        return None
    body = text[1:].strip()
    if not body:
        return None
    head_end = len(body)
    for i, ch in enumerate(body):
        if ch in (" ", "\n", "\t"):
            head_end = i
            break
    head = body[:head_end]
    rest = body[head_end:].strip()
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
        return f"Perintah `/{name}` tidak dikenal. Ketik /help."
    try:
        return await handler(db, user, chat_id, args, message)
    except Exception as e:
        logger.exception("whatsapp command handler failed")
        return f"⚠️ Terjadi error: {e}"
