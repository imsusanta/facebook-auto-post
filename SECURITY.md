# Security

See [Security and PostgreSQL setup](docs/SECURITY_SETUP.md) for configuration, implemented controls, test scope and remaining limitations.

Never commit credentials, email verification links, password-reset links, session cookies, database exports or encryption keys. Production deployments require HTTPS, a secret manager and working SMTP. Test changes against a dedicated database and a dedicated Facebook Page before deployment.

For a suspected vulnerability, use GitHub private vulnerability reporting if the repository owner has enabled it. Do not put live tokens or customer data in public issues. Otherwise contact the repository owner through an established private channel.

This implementation has local regression coverage; it is not a substitute for independent security review or production integration testing.
