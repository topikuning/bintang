"""Regression test untuk SECRET_KEY production guard (PR #69).

Production deploy harus REFUSE BOOT kalau SECRET_KEY masih default.
Fernet key utk app_settings di-derive dari SECRET_KEY -- kalau default
terpakai di prod, siapa pun yg tahu default bisa decrypt semua secret
(API key, TG/WA token) -> compromise penuh.
"""
from __future__ import annotations

import pytest

from app.core.config import settings
from app.main import _DEFAULT_SECRET_KEY, _guard_production_config


@pytest.fixture
def restore_settings():
    """Save & restore env config -- supaya test tdk bocor antar each."""
    saved = (settings.APP_ENV, settings.SECRET_KEY, settings.ALLOWED_ORIGINS)
    yield
    settings.APP_ENV, settings.SECRET_KEY, settings.ALLOWED_ORIGINS = saved


# Audit #H6 menambah CORS validation di _guard_production_config -- semua
# test prod yg tdk peduli CORS harus set ALLOWED_ORIGINS ke value valid.
_VALID_PROD_ORIGIN = "https://app.bintang.com"


def test_dev_default_secret_allowed(restore_settings):
    """Dev pakai default SECRET_KEY -- boleh boot."""
    settings.APP_ENV = "dev"
    settings.SECRET_KEY = _DEFAULT_SECRET_KEY
    _guard_production_config()  # no raise


def test_prod_default_secret_refused(restore_settings):
    """Prod pakai default SECRET_KEY -- REFUSE BOOT."""
    settings.APP_ENV = "prod"
    settings.SECRET_KEY = _DEFAULT_SECRET_KEY
    settings.ALLOWED_ORIGINS = _VALID_PROD_ORIGIN
    with pytest.raises(RuntimeError, match="REFUSE_BOOT"):
        _guard_production_config()


def test_prod_short_secret_refused(restore_settings):
    """Prod pakai SECRET_KEY pendek -- REFUSE BOOT."""
    settings.APP_ENV = "prod"
    settings.SECRET_KEY = "short"
    settings.ALLOWED_ORIGINS = _VALID_PROD_ORIGIN
    with pytest.raises(RuntimeError, match="terlalu pendek"):
        _guard_production_config()


def test_prod_strong_secret_allowed(restore_settings):
    """Prod + strong SECRET_KEY (>=32 char, beda dr default) + valid
    ALLOWED_ORIGINS -- OK."""
    settings.APP_ENV = "prod"
    settings.SECRET_KEY = "a" * 48
    settings.ALLOWED_ORIGINS = _VALID_PROD_ORIGIN
    _guard_production_config()  # no raise


def test_production_alias_recognized(restore_settings):
    """APP_ENV='production' (alias 'prod') juga ke-guard."""
    settings.APP_ENV = "production"
    settings.SECRET_KEY = _DEFAULT_SECRET_KEY
    settings.ALLOWED_ORIGINS = _VALID_PROD_ORIGIN
    with pytest.raises(RuntimeError, match="REFUSE_BOOT"):
        _guard_production_config()
