from app.services.po_teks import baca


def _ringkas(h):
    return [(b["description"], b["quantity"], b["unit"], b["unit_price"]) for b in h.barang]


def test_baris_kunci_dan_nominal():
    h = baca("proyek klbrt\nvendor Tedi Yulianto Prabowo\nMaterial 11jt\nKasbon Pekerja 1 ls 70jt")
    assert (h.proyek, h.vendor) == ("klbrt", "Tedi Yulianto Prabowo")
    assert _ringkas(h) == [
        ("Material", 1.0, "ls", 11_000_000.0),
        ("Kasbon Pekerja", 1.0, "ls", 70_000_000.0),
    ]
    assert h.sisa == []


def test_variasi_nominal_dan_baris_tanpa_nominal_untuk_ai():
    h = baca(
        "Semen Tonasa 50 kg = 200 sak\nPasir cor 5 m3 @300rb\nproyek: BMJ1\npemasok CV Sumber\n"
        "Besi 10 polos = 270 lonjor @ Rp 95.000\nCat 2 pail 1,5jt\ncatatan kirim jumat"
    )
    assert (h.proyek, h.vendor, h.catatan) == ("BMJ1", "CV Sumber", "kirim jumat")
    assert _ringkas(h) == [
        ("Pasir cor", 5.0, "m3", 300_000.0),
        ("Besi 10 polos", 270.0, "lonjor", 95_000.0),
        ("Cat", 2.0, "pail", 1_500_000.0),
    ]
    # Angka tanpa rb/jt/Rp/@ (50 kg, 200 sak) bukan harga: diserahkan ke AI.
    assert h.sisa == [(0, "Semen Tonasa 50 kg = 200 sak")]
