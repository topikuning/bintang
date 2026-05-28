# CACAK Frontend v2 — Blueprint

Adaptive Financial Reporting Web App. Desktop = table-first / data grid lengkap. Tablet = adaptive (tabel ringkas + side panel). Mobile = report-first (summary cards + card list + bottom sheet).

Stack: React 19 + Vite 6 + TypeScript + Tailwind v4 + shadcn/ui + Radix + TanStack Table v8 + TanStack Query v5 + React Router v7 + React Hook Form + Zod + Recharts + ExcelJS. Backend tidak diubah — kontrak API existing tetap dipakai.

---

## 1. Prinsip Inti (non-negotiable)

| # | Prinsip | Implikasi konkret |
|---|---|---|
| 1 | **Keterbacaan angka di atas estetika** | Font tabular-nums, alignment kanan, IDR konsisten, negatif sangat jelas |
| 2 | **Mobile = report-first, bukan table-first** | Default landing per modul = ringkasan kartu, tabel hanya on-demand |
| 3 | **Desktop = data grid kuat** | TanStack Table dengan sticky header, sticky kolom 1, resize, pagination, column picker |
| 4 | **Satu sumber kebenaran data, banyak cara presentasi** | Hook query yang sama (mis. `useTransactions()`) dipakai oleh data-grid (desktop), card-list (mobile), summary cards |
| 5 | **Auditability eksplisit** | Setiap mutasi keuangan punya konfirmasi + soft-delete + visible audit trail |
| 6 | **Tidak ada modal kecil di mobile** | Mobile pakai bottom sheet full-width / fullscreen drawer |
| 7 | **PDF & Excel adalah dokumen, bukan screenshot** | Backend (WeasyPrint + openpyxl) tetap source of truth utk export. Frontend hanya trigger download |
| 8 | **Format Rupiah konsisten** | `Rp 1.250.000.000` (titik ribuan, tanpa desimal default), negatif `−Rp 25.000.000` (en-dash, bukan minus, untuk visual berat) |

---

## 2. Sitemap & Routing

URL hierarki dirancang supaya scope (proyek/perusahaan) terlihat di URL — gampang di-bookmark dan share.

```
/login

/                                  (redirect ke /dashboard)
/dashboard                          → DashboardGlobal (multi-project)
/p/:projectId                       → DashboardProject
/p/:projectId/transactions          → list transaksi proyek
/p/:projectId/transactions/new
/p/:projectId/transactions/:id      → side panel/detail
/p/:projectId/invoices
/p/:projectId/invoices/new
/p/:projectId/invoices/:id
/p/:projectId/purchase-orders
/p/:projectId/purchase-orders/new
/p/:projectId/purchase-orders/:id
/p/:projectId/budget                → budget vs actual proyek
/p/:projectId/team                  → anggota proyek (project_users)

/transactions                       → cross-project (admin) -- sama UI, tanpa proyek scope
/invoices
/purchase-orders

/reports                            → entry: pilih jenis laporan
/reports/cashflow
/reports/transactions
/reports/invoices
/reports/debts                      → hutang & piutang
/reports/budget
/reports/purchase-orders
/reports/audit-log

/master/projects
/master/companies
/master/categories
/master/vendors-clients
/master/users

/settings                            → preferensi user (default project, theme, locale, notif)
/audit-log                           → tab dari /reports/audit-log + filter cepat

/more                                (mobile only — overflow menu)
```

### Bottom navigation mobile (5 menu max)

| Icon | Label | Route |
|---|---|---|
| Home | Beranda | `/dashboard` atau `/p/:lastProject` |
| FolderKanban | Proyek | `/master/projects` (atau picker) |
| ArrowLeftRight | Transaksi | `/transactions` (current scope) |
| Receipt | Invoice | `/invoices` (current scope) |
| BarChart3 | Laporan | `/reports` |

Sisanya (PO, Budget, Master Data, Settings, Audit Log, Users, Companies) masuk ke **`/more`**.

---

## 3. Design System

### 3.1 Palet warna (Tailwind tokens)

Foundation netral + 1 warna brand + warna status terdefinisi. Tidak boleh ada warna ad-hoc di komponen.

```ts
// tailwind tokens (di-extend via CSS vars utk dark mode kelak)
colors: {
  brand: {
    50:  '#f0f7ff',  500: '#0a5dc2',  600: '#054a9e',  // navy biru, profesional finance
    700: '#063a7a',  900: '#022554',
  },
  // Status — 4 saja, jangan tambah
  success:  { 50:'#f0fdf4', 500:'#16a34a', 700:'#15803d' },  // verified, paid, aman
  warning:  { 50:'#fffbeb', 500:'#d97706', 700:'#b45309' },  // submitted, partial, mendekati budget
  danger:   { 50:'#fef2f2', 500:'#dc2626', 700:'#b91c1c' },  // overbudget, overdue, rejected
  info:     { 50:'#eff6ff', 500:'#2563eb', 700:'#1d4ed8' },  // draft, info ringan
  // Netral
  ink:      { 900:'#0a0a0a', 700:'#404040', 500:'#737373', 300:'#d4d4d4', 100:'#f5f5f5' },
  surface:  { DEFAULT:'#ffffff', muted:'#fafafa', sunken:'#f4f4f5' },
}
```

Aturan: angka pemasukan/positif boleh menonaktifkan warna (default ink-900); angka pengeluaran/negatif boleh `text-danger-700` di summary cards saja, bukan di tabel detail (tabel tetap netral, tanda "−" yang membedakan).

### 3.2 Typography

| Token | Size | Line-height | Weight | Use |
|---|---|---|---|---|
| `display`     | 24px / 1.2 | 700 | Judul halaman dashboard, page title |
| `h1`          | 18px / 1.3 | 700 | Section title |
| `h2`          | 14px / 1.4 | 700 | Card title, table heading |
| `body`        | 14px / 1.5 | 400 | Default body |
| `body-sm`     | 13px / 1.45 | 400 | Tabel desktop, secondary text |
| `caption`     | 12px / 1.4 | 500 | Label form, status badge |
| `mono-num`    | 14px / 1.4 | 600 | `tabular-nums`, semua nominal Rupiah |

Font: `Inter` (UI) + `JetBrains Mono` (numerik). Self-host dari `/public/fonts/` (tidak pakai Google Fonts CDN untuk privasi & latency offline-first).

### 3.3 Spacing

Tailwind default scale (4px base). Aturan: `p-3` untuk card padding mobile, `p-4` desktop. Gap antar section: `space-y-4` mobile, `space-y-6` desktop.

### 3.4 Format angka

Helper di `lib/format.ts`:

```ts
fmtIDR(1250000000)              // "Rp 1.250.000.000"
fmtIDR(-25000000)               // "−Rp 25.000.000"  (en-dash 0x2013)
fmtIDR(1250000.5, {decimal: 2}) // "Rp 1.250.000,50"
fmtCompact(1_250_000_000)       // "Rp 1,25 M"  (utk summary card mobile)
fmtPct(0.853)                   // "85,3%"
fmtDate(d)                      // "01 Sep 2026"
fmtDateTime(dt)                 // "01 Sep 2026 14:35"
fmtRelative(dt)                 // "2 jam lalu", "kemarin"
```

### 3.5 Status badge (taksonomi)

Definisi sekali, dipakai di mana pun.

```ts
// Transaction
DRAFT      → info (biru)        "Draft"
SUBMITTED  → warning (oranye)   "Menunggu validasi"
VERIFIED   → success (hijau)    "Tervalidasi"
REJECTED   → danger (merah)     "Ditolak"
CANCELLED  → ink-500 (abu)      "Dibatalkan"

// Invoice
DRAFT             → info       "Draft"
ISSUED            → warning    "Belum lunas"
PARTIALLY_PAID    → warning    "Sebagian"
PAID              → success    "Lunas"
OVERDUE           → danger     "Jatuh tempo"
CANCELLED         → ink-500    "Dibatalkan"

// PO
DRAFT      → info, ISSUED → warning, APPROVED → success, CANCELLED → ink

// Budget status (per proyek)
budget_aman       (≤80%)   → success
mendekati_batas   (80–100%) → warning
overbudget        (>100%)  → danger
no_budget         → ink-500
```

### 3.6 Komponen ikon

`lucide-react`. Icon mapping konsisten:

| Konsep | Icon |
|---|---|
| Pemasukan / IN | `ArrowDownLeft` (panah masuk) |
| Pengeluaran / OUT | `ArrowUpRight` |
| Invoice masuk (hutang) | `FileMinus` |
| Invoice keluar (piutang) | `FilePlus` |
| Purchase Order | `ShoppingCart` |
| Validasi | `BadgeCheck` |
| Tertunda | `Clock` |
| Ditolak | `XCircle` |
| Lampiran | `Paperclip` |
| Filter | `SlidersHorizontal` |
| Export | `Download` |
| Tambah | `Plus` |

---

## 4. Strategi Responsive

### 4.1 Breakpoints

Override Tailwind default supaya semantic match konteks finance app:

```ts
screens: {
  'sm':  '480px',   // HP besar landscape, phablet
  'md':  '768px',   // tablet portrait
  'lg':  '1024px',  // tablet landscape, laptop kecil
  'xl':  '1280px',  // desktop standar
  '2xl': '1536px',  // desktop besar / dual monitor
}
```

| Breakpoint | Mode | Layout shell | Data presentation |
|---|---|---|---|
| `< 768px` (mobile) | report-first | Top app bar + bottom nav + bottom sheet | Summary cards + card list, NO data grid by default |
| `768–1024px` (tablet) | adaptive | Top app bar + nav rail tipis (icon only, expand on hover/tap) | Tabel ringkas (4–5 kolom) + side drawer detail |
| `>= 1024px` (desktop) | table-first | Sidebar lebar + topbar + side panel | Data grid lengkap, sticky header & col-1, side panel detail |

### 4.2 Container widths

```
mobile:  full-width, 16px gutter
tablet:  full-width content, 20px gutter, max-w-screen
desktop: sidebar 240px + main fluid, max-w-[1600px] center kalau >2xl
```

### 4.3 Touch targets

Mobile minimum 44×44px. Spacing antar tombol minimum 8px. Bottom nav height 56px + safe-area-inset-bottom.

---

## 5. Layout Shells per Breakpoint

### 5.1 Desktop (≥ 1024px)

```
┌─────────────────────────────────────────────────────────────┐
│ Topbar: brand + project switcher + search + user menu       │
├─────┬───────────────────────────────────────┬───────────────┤
│     │                                       │ Side panel    │
│  S  │  Main content                         │ (optional,    │
│  i  │  - Page title + breadcrumb            │  detail row)  │
│  d  │  - Filter bar                         │               │
│  e  │  - Summary cards (kalau report)       │               │
│  b  │  - Data grid                          │               │
│  a  │  - Pagination                         │               │
│  r  │                                       │               │
│ 240 │                                       │  320–480px    │
│     │                                       │               │
└─────┴───────────────────────────────────────┴───────────────┘
```

- Sidebar: brand + nav grouped (Operasional, Master, Laporan, Sistem). Collapsible ke icon-only via `Cmd+B`.
- Side panel: muncul saat klik baris di tabel; tidak menutup tabel — split view 60/40.
- Command palette (`Cmd+K`): jump-to-page, jump-to-project, quick-actions.

### 5.2 Tablet (768–1024px)

```
┌─────────────────────────────────────────────────────────────┐
│ Topbar: hamburger + brand + project switcher + user         │
├──┬──────────────────────────────────────────────────────────┤
│  │                                                          │
│ R│  Main content (tabel ringkas 4–5 kolom)                  │
│ a│                                                          │
│ i│  Side drawer (slide from right, 360px) saat klik baris   │
│ l│                                                          │
│56│                                                          │
└──┴──────────────────────────────────────────────────────────┘
```

- Nav rail icon-only 56px. Klik = navigate, hover/long-press = label tooltip.
- Side panel ganti jadi drawer modal (overlay).
- Filter masuk ke drawer kiri (slide).

### 5.3 Mobile (< 768px)

```
┌─────────────────────────────────────┐
│ App bar: project picker + search    │  56px sticky
├─────────────────────────────────────┤
│                                     │
│  Summary cards (1 kolom vertikal)   │
│                                     │
│  Filter chip-row (horizontal scroll)│
│                                     │
│  Card list                          │
│  ┌─────────────────────────────────┐│
│  │ Tgl  · Kategori · Status badge  ││
│  │ Pihak / Deskripsi               ││
│  │                          Rp X    ││
│  │                                  ││
│  └─────────────────────────────────┘│
│  ...                                │
│                                     │
│  [Load more / pagination]           │
│                                     │
├─────────────────────────────────────┤
│ Bottom nav (5 menu)                 │  56px + safe-area
└─────────────────────────────────────┘

FAB (Floating Action Button) di pojok kanan bawah, di atas bottom nav,
utk aksi utama per halaman (mis. "+" tambah transaksi).

Bottom sheet utk: filter, pilih proyek/vendor/kategori, detail singkat, aksi cepat.
Fullscreen drawer utk: form (tambah/edit transaksi/invoice/PO).
```

---

## 6. Komponen Library

### 6.1 shadcn/ui yang di-install

```
button, card, dialog, sheet, drawer, dropdown-menu, command,
input, textarea, select, checkbox, radio-group, switch,
form (rhf adapter), label,
table, separator, tabs, accordion, collapsible,
badge, skeleton, alert, toast (sonner), tooltip, popover,
calendar, date-picker (custom built on radix-popover + react-day-picker),
avatar, scroll-area, navigation-menu, sidebar, breadcrumb,
pagination, progress
```

### 6.2 Komponen custom (di `src/components/`)

```
layout/
  AppShell.tsx              ← deteksi breakpoint, render layout sesuai
  DesktopShell.tsx
  TabletShell.tsx
  MobileShell.tsx
  Sidebar.tsx (desktop)
  NavRail.tsx (tablet)
  BottomNav.tsx (mobile)
  Topbar.tsx
  ProjectSwitcher.tsx
  UserMenu.tsx
  SidePanel.tsx (desktop split view)
  CommandPalette.tsx (Cmd+K)

data/
  AdaptiveDataView.tsx      ← orchestrator: render DataGrid OR CardList by breakpoint
  DataGrid.tsx              ← TanStack Table wrapper, desktop+tablet
  CardList.tsx              ← mobile card list
  CardItem.tsx              ← single card
  ColumnPicker.tsx          ← toggle visibility, simpan ke localStorage
  FilterBar.tsx (desktop)
  FilterDrawer.tsx (mobile/tablet — bottom sheet)
  FilterChipRow.tsx (mobile — horizontal active filters)
  Pagination.tsx
  SortIndicator.tsx
  EmptyState.tsx
  ErrorState.tsx
  LoadingState.tsx (skeleton variant)
  ExportMenu.tsx            ← PDF / Excel dropdown
  SummaryCard.tsx           ← satu metric card
  SummaryCardGrid.tsx       ← grid responsif

forms/
  AmountInput.tsx           ← format on type, parse balik ke number
  DatePickerField.tsx
  ProjectPickerField.tsx
  CategoryPickerField.tsx
  VendorPickerField.tsx
  AttachmentUploader.tsx
  FormSheet.tsx             ← wrapper Sheet/Drawer utk form mobile

domain/
  TransactionRow.tsx        ← row utk DataGrid
  TransactionCard.tsx       ← card utk mobile
  TransactionDetail.tsx     ← side panel content
  InvoiceRow / InvoiceCard / InvoiceDetail
  POROW / POCard / PODetail
  AllocationManager.tsx     ← UI alokasi pembayaran ke invoice (kompleks, dedicated)
  BudgetProgressBar.tsx
  StatusBadge.tsx           ← polymorphic: TxnStatus | InvoiceStatus | POStatus | BudgetStatus
  AmountDisplay.tsx         ← tabular-num + sign-aware coloring
  DateDisplay.tsx
  AuditTrailList.tsx
  AttachmentPreview.tsx     ← thumbnail + lightbox
  Lightbox.tsx
```

---

## 7. Pola Tabel Adaptif (Inti Aplikasi)

### 7.1 AdaptiveDataView — orchestrator

Komponen tunggal yang dipakai di semua list-page. Behavior:

```tsx
<AdaptiveDataView
  data={transactions}
  isLoading={...}
  // Definisi kolom — dipakai utk DataGrid (semua kolom) DAN CardList (kolom tertentu prioritas)
  columns={[
    { id: 'tx_date',     header: 'Tanggal',  cell: ..., priority: 1, mobile: 'header-left'  },
    { id: 'amount',      header: 'Nominal',  cell: ..., priority: 1, mobile: 'header-right' },
    { id: 'party_name',  header: 'Pihak',    cell: ..., priority: 2, mobile: 'body-line-1'  },
    { id: 'description', header: 'Deskripsi',cell: ..., priority: 2, mobile: 'body-line-2'  },
    { id: 'category',    header: 'Kategori', cell: ..., priority: 3, mobile: 'meta'         },
    { id: 'status',      header: 'Status',   cell: ..., priority: 1, mobile: 'badge'        },
    { id: 'method',      header: 'Metode',   cell: ..., priority: 4, mobile: 'detail-only'  }, // tampil di expand
    // ...
  ]}
  // Filter definition — sekali, dipakai FilterBar (desktop) DAN FilterDrawer (mobile)
  filters={[
    { id: 'project',  type: 'select',  label: 'Proyek',     options: projectOpts },
    { id: 'date',     type: 'daterange', label: 'Periode' },
    { id: 'status',   type: 'multi-select', label: 'Status', options: statusOpts },
    { id: 'category', type: 'select',  label: 'Kategori',   options: catOpts },
    { id: 'q',        type: 'search',  label: 'Cari nomor / pihak / deskripsi' },
  ]}
  onRowClick={openDetail}
  exportTargets={['pdf', 'xlsx']}
  exportEndpoint="/api/v1/reports/transactions"
  emptyState={<EmptyState ... />}
/>
```

Internal:
- Desktop: render `<DataGrid>` (TanStack Table) dgn semua kolom + `<FilterBar>` di atas + `<SidePanel>` di kanan
- Tablet: `<DataGrid>` dengan kolom prioritas 1–3 saja, `<FilterDrawer>`, `<SidePanel>` jadi `<Sheet side="right">`
- Mobile: `<CardList>` rendering per item dengan layout dari `mobile:` prop di kolom + `<FilterChipRow>` + `<FilterDrawer>` (bottom sheet) + detail jadi `<Sheet side="bottom" full>`

### 7.2 Aturan jumlah kolom mobile (matching brief)

| Jumlah kolom data | Mobile presentation |
|---|---|
| 1–3 | Compact table 100% width |
| 4–6 | Card dengan 4–5 field prioritas, sisanya di expand |
| 7–10 | Card list selalu, dgn expandable detail |
| 10+ | Card list + arahkan ke "Lihat sebagai tabel" → buka column-picker bottom sheet |

Setiap card mobile WAJIB punya:
- **Header row**: tanggal (kiri kecil, ink-500) + nominal (kanan, mono-num bold besar)
- **Body line 1**: nama pihak/proyek/vendor (truncate 1 baris)
- **Body line 2**: deskripsi/kategori (truncate 1 baris, ink-500 13px)
- **Footer row**: status badge (kiri) + indikator lampiran (kanan, ikon Paperclip kalau ada)
- Tap area: seluruh card; chevron-right halus di kanan utk afford "drill-down"

Contoh rendered (TransactionCard):

```
┌────────────────────────────────────────────────┐
│ 30 Mar 2026                  −Rp 500.000.000  │
│ Bank Jatim · Deposito Jaminan                 │
│ Operasional · Tervalidasi          [📎]   ›  │
└────────────────────────────────────────────────┘
```

### 7.3 Compact table mobile (saat user memilih "Lihat sebagai tabel")

Maksimum 4 kolom default: Tanggal · Pihak (truncate) · Nominal · Status. Tap → buka detail bottom sheet. Column picker via icon di header.

### 7.4 DataGrid desktop — fitur wajib

| Fitur | Implementasi |
|---|---|
| Sticky header | `position: sticky; top: 0` dalam scroll-area dgn `overflow: auto` |
| Sticky kolom 1 (tanggal/no-doc) | `position: sticky; left: 0; z: 1` |
| Resize kolom | TanStack Table `enableColumnResizing` |
| Sort multi-kolom | Shift+click |
| Column visibility | Dropdown di toolbar, persist `localStorage` per-page |
| Row hover | `bg-surface-muted` |
| Row select (kalau bulk action) | Checkbox col-0, select-all di header |
| Subtotal / total row | tfoot dengan double-rule, sticky bottom |
| Group by (mis. proyek) | `getGroupedRowModel`, expandable group rows |
| Pagination | 25 / 50 / 100 / 200, persist di localStorage |
| Empty / loading / error | dedicated states |
| Export | tombol PDF + Excel di toolbar; trigger backend endpoint |

---

## 8. Layout per Modul

### 8.1 Dashboard

**Desktop:**
```
┌──────────────────────────────────────────────────────────────┐
│ Title: Dashboard <Project Name>          [Periode picker]    │
│                                                              │
│ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐      │  
│ │Saldo │ │Inflow│ │Outflw│ │Hutang│ │Pieut.│ │Budget│      │ summary cards
│ └──────┘ └──────┘ └──────┘ └──────┘ └──────┘ └──────┘      │
│                                                              │
│ ┌─────────────────────────┐ ┌──────────────────────────┐    │
│ │ Cashflow chart (12 mo) │ │ Budget vs Actual progress│    │
│ └─────────────────────────┘ └──────────────────────────┘    │
│                                                              │
│ ┌─────────────────────────┐ ┌──────────────────────────┐    │
│ │ Transaksi terbaru       │ │ Invoice jatuh tempo      │    │
│ │ (mini table 5 row)      │ │ (mini table 5 row)       │    │
│ └─────────────────────────┘ └──────────────────────────┘    │
│                                                              │
│ ┌─────────────────────────┐ ┌──────────────────────────┐    │
│ │ Proyek overbudget       │ │ Belum tervalidasi (n)    │    │
│ └─────────────────────────┘ └──────────────────────────┘    │
└──────────────────────────────────────────────────────────────┘
```

**Mobile:**
```
┌─────────────────────────┐
│ Beranda     [Project ▾] │
│ ┌─────────────────────┐ │
│ │ Saldo    Rp X        │ │  warning banner kalau saldo < 0
│ └─────────────────────┘ │
│ ┌─────────┬─────────┐   │
│ │Inflow   │Outflow  │   │
│ └─────────┴─────────┘   │
│ ⚠ 3 invoice jatuh tempo │
│ ⚠ 1 proyek overbudget   │
│ Cashflow (sparkline)    │
│                         │
│ Transaksi terbaru       │
│ ┌─────────────────────┐ │
│ │ card #1             │ │
│ │ card #2             │ │
│ │ card #3             │ │
│ └─────────────────────┘ │
│ [Lihat semua]           │
│                         │
│ Aksi cepat:             │
│ [+ Transaksi] [+Invoice]│
│ [↓ Export laporan]      │
└─────────────────────────┘
```

### 8.2 Laporan (Reports — entry page + detail)

**Desktop entry:**
- Grid kartu pilih jenis laporan (Cashflow / Transaksi / Invoice / Hutang-Piutang / Budget / PO / Audit Log) → klik buka tab dengan filter+preview
- Tabs di top: [Overview] [Transaksi] [Invoice] [Budget] [Vendor] [Audit Trail]

**Desktop laporan detail (mis. Cashflow):**
```
┌─────────────────────────────────────────────────────────────┐
│ ← Reports / Cashflow                                        │
│ FilterBar: [Periode ▾] [Proyek ▾] [Status ▾]   [Export ▾]  │
│                                                             │
│ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐                        │
│ │Pemas.│ │Penge.│ │Saldo │ │Total │  summary cards          │
│ └──────┘ └──────┘ └──────┘ └──────┘                        │
│                                                             │
│ Tabel detail (sticky header, sticky col 1):                │
│ ┌──────────────────────────────────────────────────────────┐│
│ │ Tgl │ Proy │ Pihak │ Desk │ Masuk │ Keluar │             ││
│ │ ... 100 baris ...                                        ││
│ │ TOTAL                          Rp X      Rp Y            ││
│ └──────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────┘
```

**Mobile laporan detail:**
```
┌─────────────────────────┐
│ ← Cashflow              │
│ Periode: 1 Mei – 30 Jun │
│ Proyek: KNMP Mataram    │
│ [Filter] [Tabel]   [⤓]  │
│                         │
│ Pemasukan   Rp 1,6 M    │
│ Pengeluaran Rp 3,8 M    │
│ Saldo      −Rp 2,2 M    │
│                         │
│ Breakdown per kategori: │
│ ▸ Operasional   Rp X    │
│ ▸ Material      Rp X    │
│                         │
│ Detail transaksi:       │
│ [card list ...]         │
│                         │
│ [⤓ PDF] [⤓ Excel]       │
└─────────────────────────┘
```

### 8.3 Transaksi (list)

**Desktop**: AdaptiveDataView desktop mode. Side panel detail saat klik row. Bulk-select utk approval massal (untuk admin).

**Mobile**: 
- Search bar besar di top
- Filter chip row (active filter visible)
- Card list
- FAB `+ Transaksi`
- Tap card → fullscreen detail

### 8.4 Invoice

**Desktop**: tabel + side panel detail dgn progress pembayaran + linked transactions + tombol "Sambungkan transaksi" (allocation).

**Mobile**:
```
Card invoice:
┌──────────────────────────────────────┐
│ INV-2025/12/001          [Lunas]    │  ← status badge besar
│ PT Vendor XYZ                        │
│ Total       Rp 100.000.000           │
│ Terbayar    Rp 80.000.000            │
│ Sisa        Rp 20.000.000            │
│ ████████████████████░░░░  80%        │  ← progress bar
│ [Detail] [+ Pembayaran] [Sambungkan] │  ← inline action buttons
└──────────────────────────────────────┘
```

Tap card → fullscreen detail dgn:
- header invoice
- tab [Detail] [Items] [Pembayaran] [Lampiran] [Audit]
- tombol fixed di bawah: `Tambah Pembayaran`

### 8.5 Purchase Orders

Pola sama dgn Invoice. Card mobile:
```
┌──────────────────────────────────────┐
│ PO/MTR/2025/12/045    [Disetujui]   │
│ Vendor: PT Beton Jaya                │
│ Total: Rp 150.000.000                │
│ Tanggal: 12 Des 2025                 │
│ [Detail] [Cetak PO]                  │
└──────────────────────────────────────┘
```

### 8.6 Budget vs Actual (per proyek)

**Desktop**: tabel kategori × (budget / actual / variance / %), grouped by parent kategori, dengan total row.

**Mobile**: list kategori, tiap baris dgn progress bar:
```
┌──────────────────────────────────────┐
│ Operasional Lapangan                 │
│ ████████████░░░░░  75% (Rp 75/100M)  │
│ Sisa: Rp 25.000.000   ✓ Aman         │
└──────────────────────────────────────┘
┌──────────────────────────────────────┐
│ Material Beton                       │
│ ████████████████████  108% (Rp 108M) │
│ Lewat: Rp 8.000.000   ⚠ Overbudget  │
└──────────────────────────────────────┘
```
Tap → drill-down list transaksi kategori tsb.

### 8.7 Vendor / Client

Mobile card:
```
┌──────────────────────────────────────┐
│ PT Vendor XYZ                        │
│ NPWP 01.234.567.8-901.000            │
│ Total transaksi: Rp 1,2 M (12 trx)   │
│ Outstanding hutang: Rp 25 jt         │
│ [Detail] [Riwayat transaksi]         │
└──────────────────────────────────────┘
```

### 8.8 Audit Log

Mobile: timeline list dengan grouping per hari.
```
─── 30 Mar 2026 ───
14:35  Topik H. memvalidasi Transaksi #1234 (Rp 500jt)
13:02  Andi membuat Invoice INV-2025/12/045
─── 29 Mar 2026 ───
...
```
Filter di bottom sheet: tanggal, user, entity (Transaksi/Invoice/PO/User), aksi.

### 8.9 Settings (per user)

Mobile fullscreen list. Section: Profil, Tampilan (theme, density), Default proyek, Notifikasi (kelak).

---

## 9. Form (tambah/edit transaksi/invoice/PO)

### 9.1 Pola desktop

Modal sheet dari kanan (lebar 480px) atau halaman penuh kalau form panjang (mis. invoice dengan items). Tombol Simpan & Batal di footer sticky.

### 9.2 Pola mobile

**Fullscreen drawer** dari bawah, slide up. Aturan:
- Topbar: tombol close (X kiri) + judul + Simpan (kanan, primary)
- Single-column layout, label di atas field
- Section dengan accordion kalau >5 field
- Tombol Simpan SELALU visible (sticky bottom dengan safe-area-inset)
- Picker (kategori, vendor, proyek) buka bottom sheet level-2 dengan search di top
- Date picker pakai native `<input type="date">` di mobile (UX terbaik)
- Amount input: format on type, keyboard `inputMode="numeric"`

### 9.3 Allocation Manager (kompleks — dedicated)

Untuk menyambungkan transaksi pembayaran dengan invoice:

**Desktop split view:**
```
┌──────────────────────────────────┬──────────────────────────────┐
│ Invoice INV-XYZ                  │ Sumber pembayaran            │
│ Total     Rp 100.000.000         │                              │
│ Terbayar  Rp 80.000.000          │ Pilih transaksi yg punya     │
│ Sisa      Rp 20.000.000          │ saldo alokasi tersedia:      │
│                                  │ ┌──────────────────────────┐ │
│ Pembayaran sebelumnya:           │ │ TRX-1 12 Des Rp 50jt     │ │
│ ✓ TRX-A 1 Des  Rp 50jt           │ │   sisa alokasi Rp 30jt   │ │
│ ✓ TRX-B 5 Des  Rp 30jt           │ ├──────────────────────────┤ │
│                                  │ │ TRX-2 14 Des Rp 100jt    │ │
│ Tambah alokasi baru:             │ │   sisa alokasi Rp 20jt   │ │
│ Pilih transaksi → input nominal  │ └──────────────────────────┘ │
│ alokasi (max = min(sisa invoice, │                              │
│ sisa alokasi transaksi))         │ [Pilih]                      │
└──────────────────────────────────┴──────────────────────────────┘
```

**Aturan UX kritis (audit):**
- Validasi client+server: nominal alokasi ≤ min(sisa_invoice, sisa_alokasi_transaksi)
- Konfirmasi dialog sebelum submit dengan ringkasan: "Akan dibuat alokasi Rp X dari TRX-Y ke INV-Z. Setelah ini sisa invoice = Rp A, sisa alokasi transaksi = Rp B."
- Tidak boleh delete alokasi yang sudah membuat invoice PAID — harus pakai void/cancellation dengan alasan + audit log

**Mobile:** wizard 2 step:
1. Step 1: pilih transaksi sumber (search + filter berdasar tanggal & vendor)
2. Step 2: input nominal alokasi + konfirmasi
- Tombol Submit fixed di bawah

---

## 10. PDF Report (backend WeasyPrint — sudah ada, kita tetap konsumsi)

Frontend hanya:
1. Trigger download via API endpoint (mis. `GET /api/v1/reports/cashflow?format=pdf&...`)
2. Show progress / loading state ("Mempersiapkan PDF…")
3. Open di tab baru (mobile: download → buka via OS viewer)

**Standar PDF (sudah implemented di backend, dipertahankan):**
- Letterhead: logo + nama PT + alamat + NPWP (kiri), tanggal cetak + dicetak oleh + nomor referensi (kanan)
- Title block: judul UPPERCASE + scope-line (periode/proyek/status)
- Ringkasan eksekutif: 4 kartu KPI
- Section detail: tabel thin-border + tfoot TOTAL
- Footer setiap halaman: confidential notice (kiri) + "Halaman X dari N" (kanan)
- Format tanggal Indonesia: `01 Sep 2026`
- Format Rupiah: titik ribuan
- A4 landscape default utk laporan banyak kolom

**Improvement queue (kalau ada waktu):**
- [ ] Watermark "DRAFT" / "INTERNAL" optional via query param
- [ ] Tanda tangan area untuk laporan formal (PPK, Direktur)
- [ ] QR code di footer untuk verifikasi otentisitas
- [ ] Cover page utk laporan tahunan / multi-section

---

## 11. Excel Export (perlu ditambahkan, tidak ada di backend yet)

Saat ini backend hanya generate XLSX flat (`build_xlsx`). Perlu di-upgrade jadi multi-sheet untuk laporan kompleks:

**Struktur untuk Laporan Cashflow:**
- Sheet 1: `Summary` — header info + KPI
- Sheet 2: `Transaksi` — tabel detail flat (semua kolom, BUKAN versi mobile-truncated)
- Sheet 3: `Per Kategori` — pivot
- Sheet 4: `Per Proyek` — pivot

**Aturan Excel (raw data):**
- Format Rupiah pakai cell number format `"Rp "#,##0;[Red]"-Rp "#,##0` (negatif merah, parse-able sebagai number)
- Tanggal pakai cell type `Date` (bukan string), format `dd-mmm-yyyy`
- Header row: bold, freeze panes (`freezeRows=1`)
- Column width: auto-fit dengan max 40
- Worksheet protected utk header (optional)
- Filter (`autoFilter`) di header row utk semua sheet detail

**Implementasi:** ExcelJS di frontend kalau export di-trigger client-side (mis. dari data yang sudah ter-load di TanStack Query — hindari re-fetch). Untuk laporan besar (>5K rows), tetap di backend dgn streaming.

---

## 12. Aturan Tabel Mobile (Decision Matrix)

| Konteks | Pola |
|---|---|
| Listing dgn ≤3 kolom esensial (mis. Categories: kode, nama, parent) | Compact table 100% width |
| Listing 4–6 kolom (mis. Vendors) | Card 4–5 field prioritas + expand |
| Listing 7+ kolom (Transaksi, Invoice, PO) | Card list selalu, expand utk full detail |
| Laporan cashflow 7 kolom | Card list mobile, "Lihat sebagai tabel" buka column-picker |
| Reports preview/audit | Card list + filter chip + export |
| Master data sederhana (Companies) | Compact table |
| Settings list | List item dgn icon kiri + label + chevron |

**Anti-pattern yang dilarang:**
- ❌ Horizontal scroll panjang (>2 layar) sebagai default
- ❌ Tabel dengan font 10px di mobile
- ❌ Modal kecil (max-width 400px) yang menutupi konteks
- ❌ Sidebar desktop yang muncul di mobile
- ❌ Dashboard penuh chart 200×120px yang tidak terbaca

---

## 13. Konflik Mobile yang Sering Terjadi & Solusinya

| # | Konflik | Sebab | Solusi |
|---|---|---|---|
| 1 | Tabel desktop dipaksa muat di mobile | Reuse komponen tanpa adaptasi | `AdaptiveDataView` dengan render branch by breakpoint |
| 2 | Tombol terpotong gesture bar HP | Lupa safe-area-inset | `pb-[env(safe-area-inset-bottom)]` di footer fixed |
| 3 | Modal form terlalu kecil di HP | Pakai Dialog default | Mobile pakai Sheet/Drawer fullscreen |
| 4 | Filter ngambil banyak ruang | FilterBar kompleks dipasang langsung | Mobile pakai `FilterDrawer` (bottom sheet on demand) + `FilterChipRow` (active filters visible) |
| 5 | Status badge + nominal saling tabrak | Layout horizontal | Mobile vertical stack di card |
| 6 | Picker dropdown ke-cut by viewport | Radix `<Select>` overflow | Mobile force-render `<Sheet>` instead of dropdown utk picker dgn >5 opsi |
| 7 | Date picker susah dipakai | Pakai react-day-picker langsung | Mobile pakai native `<input type="date">` |
| 8 | Lampiran preview butuh banyak ruang | Grid 4 kolom | Mobile carousel horizontal scroll dengan snap |
| 9 | Bottom nav menutupi konten last-row | Tidak ada padding-bottom di main | `<main className="pb-[64px+safe-area]">` |
| 10 | FAB menutupi tombol bawah card | Z-index conflict | FAB position right-bottom dengan offset, jangan sticky-center |
| 11 | Search di topbar terlalu sempit | Brand+menu+search rebutan ruang | Mobile pisahkan: topbar (brand+icons), search bar terpisah di bawah topbar pada list page |
| 12 | Notifikasi toast tertutup keyboard | Toast posisi bottom | Toast position `top-center` di mobile saat keyboard aktif (deteksi via `visualViewport.height`) |
| 13 | Dropdown menu nempel ke trigger di mobile | Radix popover offset kecil | Override offset 8px + arrow di mobile |
| 14 | Form panjang lupa di-scroll-into-view saat error | Default RHF behavior | `useFormError` hook auto-scroll ke field error pertama |
| 15 | Pagination di mobile click area kecil | Pagination desktop dipasang | Mobile ganti ke "Load more" button atau infinite scroll dgn intersection observer |
| 16 | Tooltip tidak muncul di mobile (no hover) | Pakai tooltip default | Mobile: tap-to-show via long-press (`onPointerDown`+timer) atau ganti ke inline help text |
| 17 | Color contrast turun di outdoor | Pakai gray-500 untuk teks penting | Pastikan WCAG AA: ink-700 minimal utk body |
| 18 | Reading IDR di tabel padat | Kolom nominal terlalu sempit | Min-width 120px utk kolom IDR di tabel |

---

## 14. Pros / Cons Keputusan Kunci

| Keputusan | Pro | Con | Mitigasi |
|---|---|---|---|
| **Adaptive (3 layout) bukan responsive single** | Setiap breakpoint optimal, tidak ada "kompromi tengah" | Lebih banyak komponen utk dijaga; ada 3 path yg di-test | `AdaptiveDataView` orchestrator menjaga single source of truth utk data + filter |
| **TanStack Table v8** | Headless, fully customizable, performa bagus utk ribuan row | Bukan plug-and-play; harus tulis cell renderer | Build wrapper `<DataGrid>` sekali, reuse di semua list |
| **shadcn/ui (copy-paste, bukan npm)** | Code di project sendiri, gampang custom, no version lock-in | Update manual saat shadcn rilis baru | Gunakan CLI `shadcn add` utk consistent re-pull |
| **React Router v7** | API simpel, file-based optional, data router untuk loaders | Migrasi dari v6 minor; SSR-curious tapi tidak wajib | Tetap CSR; v7 stable, ekosistem matang |
| **Tailwind v4** | CSS native vars, faster build, no config file ribet | Masih relatif baru (Q4 2024 stable), beberapa plugin belum compat | Pin version, fall back ke v3 kalau ada blocker plugin |
| **Bottom nav 5 menu** | Industry standard mobile, mudah digapai jempol | Item lain harus ke "More" — extra step utk aksi jarang | Pilih 5 item via analytics actual usage; sisanya jelas grouped |
| **Backend tidak diubah** | No risk regresi data; deploy paralel; rollback gampang | Frontend kena keterbatasan API (mis. tidak bisa request "hanya kolom A,B,C") | Profile API; tambah endpoint baru kalau perlu (additive, tidak breaking) |
| **PDF dari backend (WeasyPrint), bukan client (jsPDF/React-PDF)** | Server-side = konsisten antar device, font terjaga, akses ke data lengkap | Network round-trip; loading state diperlukan | Sudah di-threadpool; cache logo; show progress UI |
| **Excel multi-sheet via backend** | Akses raw data, bisa diadit ulang | Develop time tambahan utk template per laporan | Mulai dari single-sheet flat (existing), upgrade per laporan saat dibutuhkan |
| **Indonesia-first language** | Audience: finance manager, direktur, PPK Indonesia | Sulit utk i18n kelak | Tetap pakai key-based translation lib (kelak), text awal Indonesia |

---

## 15. Struktur Folder

```
frontend-v2/
├── public/
│   ├── fonts/
│   │   ├── Inter-Variable.woff2
│   │   └── JetBrainsMono-Variable.woff2
│   ├── icons/
│   │   ├── manifest.json          ← PWA
│   │   └── apple-touch-icon.png
│   └── favicon.ico
├── src/
│   ├── main.tsx
│   ├── App.tsx
│   ├── routes.tsx                  ← React Router config
│   ├── env.d.ts
│   │
│   ├── lib/
│   │   ├── api.ts                  ← axios instance + interceptors (dari frontend lama, adapt)
│   │   ├── format.ts               ← fmtIDR, fmtDate, fmtCompact, fmtPct
│   │   ├── breakpoint.ts           ← useBreakpoint hook
│   │   ├── storage.ts              ← typed localStorage wrapper
│   │   ├── query-keys.ts           ← centralised TanStack Query keys
│   │   ├── error.ts                ← error parsing + toast
│   │   ├── permissions.ts          ← role checks
│   │   └── utils.ts                ← cn(), debounce, dst.
│   │
│   ├── store/
│   │   ├── auth.ts                 ← zustand store
│   │   ├── ui-prefs.ts             ← theme, density, default project
│   │   └── lightbox.ts
│   │
│   ├── types/
│   │   ├── api.ts                  ← mirror backend schemas (auto-gen via openapi-typescript kelak)
│   │   ├── domain.ts               ← Transaction, Invoice, PO, etc.
│   │   └── index.ts                ← re-export
│   │
│   ├── hooks/
│   │   ├── useAuth.ts
│   │   ├── useTransactions.ts
│   │   ├── useInvoices.ts
│   │   ├── usePOs.ts
│   │   ├── useReports.ts
│   │   ├── useProjects.ts
│   │   ├── useVendors.ts
│   │   ├── useCategories.ts
│   │   ├── useAuditLog.ts
│   │   ├── useExport.ts            ← trigger PDF/Excel download
│   │   └── useDebounce.ts
│   │
│   ├── components/
│   │   ├── ui/                     ← shadcn/ui generated
│   │   │   └── ... (button, card, dialog, sheet, table, etc.)
│   │   ├── layout/
│   │   │   ├── AppShell.tsx
│   │   │   ├── DesktopShell.tsx
│   │   │   ├── TabletShell.tsx
│   │   │   ├── MobileShell.tsx
│   │   │   ├── Sidebar.tsx
│   │   │   ├── NavRail.tsx
│   │   │   ├── BottomNav.tsx
│   │   │   ├── Topbar.tsx
│   │   │   ├── ProjectSwitcher.tsx
│   │   │   ├── UserMenu.tsx
│   │   │   ├── SidePanel.tsx
│   │   │   └── CommandPalette.tsx
│   │   ├── data/
│   │   │   ├── AdaptiveDataView.tsx
│   │   │   ├── DataGrid.tsx
│   │   │   ├── CardList.tsx
│   │   │   ├── ColumnPicker.tsx
│   │   │   ├── FilterBar.tsx
│   │   │   ├── FilterDrawer.tsx
│   │   │   ├── FilterChipRow.tsx
│   │   │   ├── Pagination.tsx
│   │   │   ├── EmptyState.tsx
│   │   │   ├── ErrorState.tsx
│   │   │   ├── LoadingState.tsx
│   │   │   ├── ExportMenu.tsx
│   │   │   ├── SummaryCard.tsx
│   │   │   └── SummaryCardGrid.tsx
│   │   ├── forms/
│   │   │   ├── AmountInput.tsx
│   │   │   ├── DatePickerField.tsx
│   │   │   ├── ProjectPickerField.tsx
│   │   │   ├── CategoryPickerField.tsx
│   │   │   ├── VendorPickerField.tsx
│   │   │   ├── AttachmentUploader.tsx
│   │   │   └── FormSheet.tsx
│   │   └── domain/
│   │       ├── transaction/
│   │       │   ├── TransactionCard.tsx
│   │       │   ├── TransactionDetail.tsx
│   │       │   ├── TransactionForm.tsx
│   │       │   └── columns.tsx     ← TanStack Table column defs
│   │       ├── invoice/
│   │       │   ├── InvoiceCard.tsx
│   │       │   ├── InvoiceDetail.tsx
│   │       │   ├── InvoiceForm.tsx
│   │       │   ├── AllocationManager.tsx
│   │       │   └── columns.tsx
│   │       ├── purchase-order/...
│   │       ├── budget/
│   │       │   ├── BudgetProgressBar.tsx
│   │       │   └── BudgetVsActual.tsx
│   │       ├── project/...
│   │       ├── vendor/...
│   │       ├── audit/
│   │       │   └── AuditTimeline.tsx
│   │       └── shared/
│   │           ├── StatusBadge.tsx
│   │           ├── AmountDisplay.tsx
│   │           ├── DateDisplay.tsx
│   │           ├── AttachmentPreview.tsx
│   │           └── Lightbox.tsx
│   │
│   └── pages/
│       ├── Login.tsx
│       ├── Dashboard.tsx           ← global / project (decide via :projectId param)
│       ├── transactions/
│       │   ├── TransactionsListPage.tsx
│       │   └── TransactionDetailPage.tsx
│       ├── invoices/
│       │   ├── InvoicesListPage.tsx
│       │   └── InvoiceDetailPage.tsx
│       ├── purchase-orders/...
│       ├── reports/
│       │   ├── ReportsHubPage.tsx
│       │   ├── CashflowReportPage.tsx
│       │   ├── TransactionsReportPage.tsx
│       │   ├── InvoicesReportPage.tsx
│       │   ├── DebtsReportPage.tsx
│       │   ├── BudgetReportPage.tsx
│       │   ├── PurchaseOrderReportPage.tsx
│       │   └── AuditLogPage.tsx
│       ├── master/
│       │   ├── ProjectsPage.tsx
│       │   ├── CompaniesPage.tsx
│       │   ├── CategoriesPage.tsx
│       │   ├── VendorsPage.tsx
│       │   └── UsersPage.tsx
│       ├── SettingsPage.tsx
│       └── MorePage.tsx            ← mobile overflow menu
│
├── tests/                          ← vitest + react-testing-library
│   ├── setup.ts
│   ├── lib/format.test.ts
│   └── components/...
│
├── .env.example
├── index.html
├── package.json
├── tsconfig.json
├── vite.config.ts
├── tailwind.config.ts
├── components.json                 ← shadcn/ui config
└── postcss.config.js
```

---

## 16. Implementation Roadmap

### Phase 0 — Foundation (target: 1 sesi)

- [ ] Scaffold `frontend-v2/` (Vite + React + TS + Tailwind v4 + shadcn init)
- [ ] Setup TanStack Query + Router + Zustand + axios interceptor
- [ ] Setup Tailwind tokens + global CSS + font self-host
- [ ] Buat lib/format.ts + lib/breakpoint.ts + lib/api.ts (port dari frontend lama)
- [ ] Auth store + Login page + protected route guard
- [ ] AppShell dengan branch desktop/tablet/mobile (skeleton)

### Phase 1 — Layout shell + 1 modul end-to-end (target: 1–2 sesi)

- [ ] DesktopShell + Sidebar + Topbar + ProjectSwitcher
- [ ] MobileShell + BottomNav + Topbar
- [ ] TabletShell + NavRail
- [ ] AdaptiveDataView orchestrator
- [ ] Module Transaksi end-to-end:
  - [ ] List page (desktop grid + mobile card)
  - [ ] Filter bar/drawer
  - [ ] Detail panel/sheet
  - [ ] Form (tambah/edit) — desktop sheet kanan, mobile fullscreen drawer

### Phase 2 — Modul utama lain (target: 2–3 sesi)

- [ ] Invoice (list + detail + form + Allocation Manager)
- [ ] Purchase Order (list + detail + form)
- [ ] Dashboard (global + per-project)

### Phase 3 — Reports & Master Data (target: 2 sesi)

- [ ] Reports Hub + 7 laporan dengan summary cards + table/card
- [ ] Trigger PDF/Excel download
- [ ] Master: Projects, Companies, Categories, Vendors, Users

### Phase 4 — Polish + advanced features (target: 1–2 sesi)

- [ ] Audit Log timeline
- [ ] Settings page
- [ ] Command palette (Cmd+K)
- [ ] Bulk actions (validasi multi-transaksi)
- [ ] Keyboard shortcuts
- [ ] PWA manifest + service worker (offline cache statics)

### Phase 5 — Cutover

- [ ] Build & deploy `frontend-v2/` ke staging URL
- [ ] User acceptance testing (minimal 3 hari real usage)
- [ ] Update FastAPI static file serving / reverse proxy untuk switch
- [ ] Decommission `frontend/` (rename ke `frontend-legacy/` simpan 30 hari)

---

## 17. Risk Register

| Risk | Likelihood | Impact | Mitigasi |
|---|---|---|---|
| Tailwind v4 plugin compat bug | Medium | Medium | Fall back ke v3.4 stable (config sama) |
| shadcn update breaks our customizations | Low | Low | Pin shadcn CLI version; review diff sebelum re-pull |
| TanStack Table virtualization belum terpakai → lambat di 5K+ rows | Medium | High | Pakai `@tanstack/react-virtual` dari awal di DataGrid |
| Mobile gesture conflict (swipe nav vs swipe-to-delete) | High | Medium | Hindari swipe-to-delete; pakai explicit button |
| Auth token expiry handling belum smooth (UX) | Medium | Medium | Refresh token flow, redirect ke login dgn `?next=` preserved |
| File upload progress di mobile | Medium | Low | Pakai axios `onUploadProgress` + show progress bar inline |
| Permissions / role visibility tidak sinkron | Medium | High | Centralized `permissions.ts` + tests |
| User pakai HP lama (browser tidak support flexbox gap) | Low | Medium | Tailwind v4 generate `gap` polyfill via margin fallback otomatis |

---

## 18. Acceptance Criteria (definition of done per modul)

Setiap modul (mis. Transaksi) baru bisa di-mark "done" kalau:

- [ ] Desktop: tabel dgn semua kolom, sticky header & col-1, sort, filter, pagination, side panel detail, export PDF & Excel
- [ ] Tablet: tabel ringkas (4-5 kolom), drawer filter, drawer detail
- [ ] Mobile: card list, search, filter chip + drawer, fullscreen detail, FAB tambah, infinite scroll / load-more
- [ ] Form: validasi (Zod), error display, sticky save button, attachment upload
- [ ] Loading state (skeleton)
- [ ] Empty state (illustration + CTA)
- [ ] Error state (retry button)
- [ ] Permission-aware (hide tombol yang tidak boleh)
- [ ] Audit-aware (mutasi kritis pakai konfirmasi dialog)
- [ ] Keyboard accessible (Tab order, Enter submit, Esc close)
- [ ] WCAG AA contrast
- [ ] Tested di Chrome, Safari iOS, Chrome Android

---

## Apendiks A. Mapping API Endpoint → Hook

```
GET  /auth/login                  → useLogin()
GET  /auth/me                     → useMe()
GET  /projects                    → useProjects()
GET  /projects/:id                → useProject(id)
GET  /transactions                → useTransactions(filters)
POST /transactions                → useCreateTransaction()
PUT  /transactions/:id            → useUpdateTransaction()
POST /transactions/:id/submit     → useSubmitTransaction()
POST /transactions/:id/verify     → useVerifyTransaction()
POST /transactions/:id/reject     → useRejectTransaction()
DELETE /transactions/:id          → useDeleteTransaction()
GET  /invoices                    → useInvoices(filters)
... (109 endpoints total — lihat backend/app/api/v1/*.py)

GET  /reports/cashflow            → useCashflowReport(filters), useExportCashflow(format)
GET  /reports/transactions        → ...
GET  /reports/invoices            → ...
GET  /reports/debts               → ...
GET  /reports/budget              → ...
GET  /reports/purchase-orders     → ...
GET  /reports/audit-logs          → ...
```

---

## Apendiks B. Format Helpers (snippet utk lib/format.ts)

```ts
const NBSP = ' '  // non-breaking space utk "Rp X"
const ENDASH = '–'

export function fmtIDR(value: number | string | null | undefined, opts?: { decimal?: number, sign?: 'always' | 'auto' | 'parens' }): string {
  const n = Number(value || 0)
  if (!isFinite(n)) return 'Rp 0'
  const decimal = opts?.decimal ?? 0
  const abs = Math.abs(n)
  const formatted = abs.toLocaleString('id-ID', { minimumFractionDigits: decimal, maximumFractionDigits: decimal })
  if (n < 0) {
    if (opts?.sign === 'parens') return `(Rp${NBSP}${formatted})`
    return `${ENDASH}Rp${NBSP}${formatted}`
  }
  if (opts?.sign === 'always' && n > 0) return `+Rp${NBSP}${formatted}`
  return `Rp${NBSP}${formatted}`
}

export function fmtCompact(value: number): string {
  const abs = Math.abs(value)
  const sign = value < 0 ? ENDASH : ''
  if (abs >= 1_000_000_000) return `${sign}Rp${NBSP}${(abs / 1e9).toFixed(2).replace('.', ',')}${NBSP}M`
  if (abs >= 1_000_000)     return `${sign}Rp${NBSP}${(abs / 1e6).toFixed(1).replace('.', ',')}${NBSP}jt`
  if (abs >= 1_000)         return `${sign}Rp${NBSP}${(abs / 1e3).toFixed(0)}rb`
  return fmtIDR(value)
}

const BULAN_SHORT = ['', 'Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des']
export function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return '-'
  const x = typeof d === 'string' ? new Date(d) : d
  if (isNaN(x.getTime())) return '-'
  return `${String(x.getDate()).padStart(2, '0')} ${BULAN_SHORT[x.getMonth()+1]} ${x.getFullYear()}`
}
```

---

End of blueprint. Setelah review & approve, lanjut ke Phase 0 (scaffold).
