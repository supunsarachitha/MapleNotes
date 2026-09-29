## Code compiled into hash-wasm's WebAssembly modules

The web app's password-derivation worker includes hash-wasm's `argon2` and `blake2b` WebAssembly modules. hash-wasm
itself is MIT (above); its license notes that the C code compiled into the modules may carry other permissive
licenses. These are the files Maple Notes ships (sources audited for v4.12.0).

### Argon2 (`src/argon2.c`) — BSD-3-Clause

Written for hash-wasm "based on Golang's Argon2 implementation from crypto package" (`golang.org/x/crypto/argon2`),
which is distributed under this license:

```text
Copyright 2009 The Go Authors.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are
met:

   * Redistributions of source code must retain the above copyright
notice, this list of conditions and the following disclaimer.
   * Redistributions in binary form must reproduce the above
copyright notice, this list of conditions and the following disclaimer
in the documentation and/or other materials provided with the
distribution.
   * Neither the name of Google LLC nor the names of its
contributors may be used to endorse or promote products derived from
this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
"AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

### BLAKE2b (`src/blake2b.c`) — CC0 1.0

The BLAKE2 reference implementation, Copyright 2012 Samuel Neves, offered under CC0 1.0, the OpenSSL License or the
Apache License 2.0 at the recipient's option. Maple Notes uses it under CC0 1.0 Universal, which requires no notice;
it is listed for completeness.
