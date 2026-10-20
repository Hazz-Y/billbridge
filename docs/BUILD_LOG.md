# Build log

- **Phase 0 (spike, ~15 min):** Go/Make installed via winget; Docker Desktop started. Drunix repo has no test-network; images exist on Docker Hub (`npcioss/*`). Fabric 2.5 test-network failed: host `C:` drive 0 bytes free, Docker VM disk on `C:` corrupted (I/O errors). → **Rung 3: MockLedger.** Docker compose files are shipped but `make demo` runs natively (Node) on this host. Interpretation: contentHash uses a pipe-delimited canonical string (not JSON) so Go and TS agree byte-for-byte.
