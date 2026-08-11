"""
Field-level encryption for sensitive user data at rest.

Passwords are protected separately by bcrypt hashing (security.py). This
module encrypts OTHER sensitive fields we store about a user - here, their
full name - so that even someone with raw read access to the Cosmos DB
container can't read it without FIELD_ENCRYPTION_KEY, which lives only in
Azure Function App Settings / Key Vault, never in the database itself.
"""
import os
from cryptography.fernet import Fernet

_fernet_instance = None


def _fernet() -> Fernet:
    global _fernet_instance
    if _fernet_instance is None:
        key = os.environ["FIELD_ENCRYPTION_KEY"]
        _fernet_instance = Fernet(key.encode())
    return _fernet_instance


def encrypt_field(plaintext: str) -> str:
    if plaintext is None:
        return None
    return _fernet().encrypt(plaintext.encode()).decode()


def decrypt_field(ciphertext: str) -> str:
    if ciphertext is None:
        return None
    return _fernet().decrypt(ciphertext.encode()).decode()
