# [0.6.0](https://github.com/CCGV2/pi-acp/compare/v0.5.0...v0.6.0) (2026-09-29)


### Bug Fixes

* pin pi dependencies and align lint tooling ([1fed908](https://github.com/CCGV2/pi-acp/commit/1fed908c824ded1f7da2beb16284ba3efb415b85))


### Features

* **mcp:** adapt server tools for pi ([84ef37f](https://github.com/CCGV2/pi-acp/commit/84ef37fdeffb8325142a3b4e1cd2cfc521d9131a))
* **mcp:** add atomic session manager ([e5c2596](https://github.com/CCGV2/pi-acp/commit/e5c259687b8bdca2979b375101add0f8abaa05c2))
* **mcp:** await session cleanup ([ec22827](https://github.com/CCGV2/pi-acp/commit/ec228273a04a2078bcb16016ab043b13a2412f13))
* **mcp:** integrate new sessions ([aa98aee](https://github.com/CCGV2/pi-acp/commit/aa98aee1971b92be9cbb9eb64fe4ce7006181b18))
* **mcp:** manage stdio connections ([b15f29f](https://github.com/CCGV2/pi-acp/commit/b15f29f6d535a448d9c6956c7198a63a1032887f))
* **mcp:** normalize server configuration ([21eb448](https://github.com/CCGV2/pi-acp/commit/21eb448cdb210ca38522ab49206a48f17eb0f76b))
* **mcp:** restore recovery paths ([6579fa0](https://github.com/CCGV2/pi-acp/commit/6579fa0bab5a5591d824c896809226939749210f))
* **mcp:** support streamable http ([c5f9feb](https://github.com/CCGV2/pi-acp/commit/c5f9febb63c53ccab5f925fd3fab135d9758c4c1))

# [0.5.0](https://github.com/victor-software-house/pi-acp/compare/v0.4.0...v0.5.0) (2026-05-19)


### Features

* **auth:** drop proactive env-sniffing; classify reactively from pi runtime ([71eef46](https://github.com/victor-software-house/pi-acp/commit/71eef46da0c9c43c82699ac4d10483ab9efdf945))
* **deps:** bump SDK to ^0.22.1, pi to @earendil-works/* ^0.75.3, node >=24 ([21248c5](https://github.com/victor-software-house/pi-acp/commit/21248c54b4fcc3def5e2b75cd93206272e526e6a))
* **runtime:** redirect console.* to stderr; drive shutdown from connection lifecycle ([beaeebc](https://github.com/victor-software-house/pi-acp/commit/beaeebc27394a1916a812783a0808712dad43cfa))
* **session:** rename close/resume to stable form, keep fork unstable ([9e190c0](https://github.com/victor-software-house/pi-acp/commit/9e190c01aab35b99ce80554bb16f7675ca269c81))

# [0.4.0](https://github.com/victor-software-house/pi-acp/compare/v0.3.0...v0.4.0) (2026-03-24)


### Features

* reference cleanup, markdown fencing, model aliases, prompt queueing (v0.4.0) ([850aa4e](https://github.com/victor-software-house/pi-acp/commit/850aa4ebb19f72deedda973efdff3539046cf291))

# [0.3.0](https://github.com/victor-software-house/pi-acp/compare/v0.2.0...v0.3.0) (2026-03-23)


### Bug Fixes

* remove zod .trim() from tool-content schemas to preserve raw output ([606eeac](https://github.com/victor-software-house/pi-acp/commit/606eeac3212c94b3b2456f0b8a665622352521a9))


### Features

* implement phases 1-6 of tool output and protocol conformance plan ([ae0d96c](https://github.com/victor-software-house/pi-acp/commit/ae0d96cbcbbfbe95dc1ec2adb990f57a27989e11))

# [0.2.0](https://github.com/victor-software-house/pi-acp/compare/v0.1.2...v0.2.0) (2026-03-23)


### Features

* acp refactor phases 1-7 ([8706333](https://github.com/victor-software-house/pi-acp/commit/8706333aea7da85bde5cb15cf114c4fee5430cf2))

## [0.1.2](https://github.com/victor-software-house/pi-acp/compare/v0.1.1...v0.1.2) (2026-03-23)


### Bug Fixes

* replace buggy findPiSessionFile with cached session path resolution ([5cff8b5](https://github.com/victor-software-house/pi-acp/commit/5cff8b59361ba35a6aa9897a5d7d5da554ca8334))

## [0.1.1](https://github.com/victor-software-house/pi-acp/compare/v0.1.0...v0.1.1) (2026-03-23)


### Bug Fixes

* correct bin entry path for tsdown output ([de04b57](https://github.com/victor-software-house/pi-acp/commit/de04b57810062ecd54bffc5f0e32770e0909aad0))
