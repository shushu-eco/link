# Security

## Reporting a weakness

Please do not open a public issue for a security problem. Write to **support@linkturbo.app** with what
you found and how to see it. You get an answer within a few days, and are named in the fix if you wish.

## What Link does to protect its users

- **Nothing is uploaded.** The extension and the program send nothing off your computer except the
  reels you post yourself.
- **Updates are signed.** Link takes an update only when it is signed with Link's own key (Ed25519).
  The key's secret half is not on GitHub.
- **Downloads can be checked.** `SHA256SUMS.txt` beside the installer and the zip is signed with the
  same key; the README says how to check a file with it.

## What is not covered yet

The installer is not signed with a Windows code-signing certificate, so Windows warns before running it.
