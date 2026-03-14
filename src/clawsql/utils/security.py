"""
Security utilities for ClawSQL.
"""

import hashlib
import secrets
from datetime import datetime, timedelta
from typing import Any, Optional

import bcrypt
from jose import JWTError, jwt


def hash_password(password: str) -> str:
    """
    Hash a password using bcrypt.

    Args:
        password: Plain text password

    Returns:
        Hashed password
    """
    # bcrypt requires bytes, encode the password
    password_bytes = password.encode('utf-8')
    # Generate salt and hash
    salt = bcrypt.gensalt()
    hashed = bcrypt.hashpw(password_bytes, salt)
    return hashed.decode('utf-8')


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """
    Verify a password against its hash.

    Args:
        plain_password: Plain text password
        hashed_password: Hashed password

    Returns:
        True if password matches
    """
    try:
        password_bytes = plain_password.encode('utf-8')
        hashed_bytes = hashed_password.encode('utf-8')
        return bcrypt.checkpw(password_bytes, hashed_bytes)
    except Exception:
        return False


def generate_token(length: int = 32) -> str:
    """
    Generate a random token.

    Args:
        length: Token length in bytes

    Returns:
        Random hex token
    """
    return secrets.token_hex(length)


def hash_string(value: str) -> str:
    """
    Hash a string using SHA-256.

    Args:
        value: String to hash

    Returns:
        Hex digest of hash
    """
    return hashlib.sha256(value.encode()).hexdigest()


class TokenManager:
    """
    Manages JWT tokens for API authentication.

    Provides token creation, validation, and refresh
    for secure API access.
    """

    def __init__(
        self,
        secret_key: str,
        algorithm: str = "HS256",
        expiry_hours: int = 24,
    ):
        """
        Initialize token manager.

        Args:
            secret_key: Secret key for signing tokens
            algorithm: JWT algorithm
            expiry_hours: Token expiry time in hours
        """
        self.secret_key = secret_key
        self.algorithm = algorithm
        self.expiry_hours = expiry_hours

    def create_token(
        self,
        subject: str,
        claims: Optional[dict[str, Any]] = None,
        expiry_hours: Optional[int] = None,
    ) -> str:
        """
        Create a JWT token.

        Args:
            subject: Token subject (usually user ID)
            claims: Additional claims to include
            expiry_hours: Override default expiry time

        Returns:
            JWT token string
        """
        now = datetime.utcnow()
        expiry = now + timedelta(hours=expiry_hours or self.expiry_hours)

        payload = {
            "sub": subject,
            "iat": now,
            "exp": expiry,
            "jti": generate_token(16),  # Unique token ID
        }

        if claims:
            payload.update(claims)

        return jwt.encode(payload, self.secret_key, algorithm=self.algorithm)

    def validate_token(self, token: str) -> Optional[dict[str, Any]]:
        """
        Validate a JWT token.

        Args:
            token: JWT token string

        Returns:
            Token payload if valid, None otherwise
        """
        try:
            payload = jwt.decode(
                token,
                self.secret_key,
                algorithms=[self.algorithm],
            )
            return payload
        except JWTError:
            return None

    def refresh_token(self, token: str) -> Optional[str]:
        """
        Refresh a valid token.

        Args:
            token: Current JWT token

        Returns:
            New JWT token if current token is valid
        """
        payload = self.validate_token(token)
        if not payload:
            return None

        # Create new token with same subject and claims
        subject = payload.get("sub", "")
        claims = {
            k: v
            for k, v in payload.items()
            if k not in ("sub", "iat", "exp", "jti")
        }

        return self.create_token(subject, claims)

    def get_token_subject(self, token: str) -> Optional[str]:
        """
        Get subject from token.

        Args:
            token: JWT token

        Returns:
            Subject if token is valid
        """
        payload = self.validate_token(token)
        if payload:
            return payload.get("sub")
        return None

    def revoke_token(self, token: str) -> bool:
        """
        Revoke a token.

        Note: In a real implementation, this would add the token
        to a revocation list or cache.

        Args:
            token: Token to revoke

        Returns:
            True (placeholder)
        """
        # In real implementation, add to revocation list
        return True

    def is_token_revoked(self, token: str) -> bool:
        """
        Check if a token is revoked.

        Args:
            token: Token to check

        Returns:
            True if revoked
        """
        # In real implementation, check revocation list
        return False


class APIKeyManager:
    """
    Manages API keys for service-to-service authentication.
    """

    def __init__(self, key_prefix: str = "clawsql"):
        """
        Initialize API key manager.

        Args:
            key_prefix: Prefix for generated keys
        """
        self.key_prefix = key_prefix
        self._keys: dict[str, dict[str, Any]] = {}

    def generate_key(
        self,
        name: str,
        permissions: Optional[list[str]] = None,
        expiry_days: Optional[int] = None,
    ) -> str:
        """
        Generate a new API key.

        Args:
            name: Key name/identifier
            permissions: List of permissions
            expiry_days: Days until expiry (None = no expiry)

        Returns:
            Generated API key
        """
        key = f"{self.key_prefix}_{generate_token(24)}"

        key_info = {
            "name": name,
            "permissions": permissions or [],
            "created_at": datetime.utcnow(),
        }

        if expiry_days:
            key_info["expires_at"] = datetime.utcnow() + timedelta(days=expiry_days)

        self._keys[key] = key_info

        return key

    def validate_key(self, key: str) -> Optional[dict[str, Any]]:
        """
        Validate an API key.

        Args:
            key: API key to validate

        Returns:
            Key info if valid, None otherwise
        """
        if key not in self._keys:
            return None

        key_info = self._keys[key]

        # Check expiry
        if "expires_at" in key_info:
            if datetime.utcnow() > key_info["expires_at"]:
                return None

        return key_info

    def revoke_key(self, key: str) -> bool:
        """
        Revoke an API key.

        Args:
            key: Key to revoke

        Returns:
            True if revoked
        """
        if key in self._keys:
            del self._keys[key]
            return True
        return False

    def list_keys(self) -> list[dict[str, Any]]:
        """
        List all API keys.

        Returns:
            List of key info dictionaries
        """
        return [
            {
                "key": key[:20] + "...",  # Partially masked
                **info,
            }
            for key, info in self._keys.items()
        ]


def generate_credentials() -> dict[str, str]:
    """
    Generate random credentials.

    Returns:
        Dictionary with username and password
    """
    return {
        "username": f"user_{secrets.token_hex(4)}",
        "password": secrets.token_urlsafe(16),
    }