# Security

Sideload handles OAuth tokens for Spotify and YouTube Music. If you find a vulnerability, email marctorrelles@gmail.com with steps to reproduce. Please do not open a public issue. You will get a reply within 7 days.

What we store: see the Privacy page (`/privacy`). Tokens are AES-GCM encrypted at rest inside a per-job Durable Object and deleted when the job finishes (Spotify) or within 24 hours (YouTube Music).
