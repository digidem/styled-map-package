# styled-map-package-api

## 5.0.0-pre.2

### Patch Changes

- [#84](https://github.com/digidem/styled-map-package/pull/84) [`609af6d`](https://github.com/digidem/styled-map-package/commit/609af6d0c795901d089022d158cdeb50bdace5a9) Thanks [@gmaclennan](https://github.com/gmaclennan)! - Add browser support to fromMBTiles, including reading mbtiles from OPFS

- [#85](https://github.com/digidem/styled-map-package/pull/85) [`c8b219c`](https://github.com/digidem/styled-map-package/commit/c8b219cffb35a3a45ff58d814d233420dd0c77a8) Thanks [@gmaclennan](https://github.com/gmaclennan)! - Add dedupe option to SMP Writer, which writes duplicate tiles once to the Zip, resulting in significantly smaller files when used with maps with many duplicate tiles.

## 5.0.0-pre.1

### Patch Changes

- [#75](https://github.com/digidem/styled-map-package/pull/75) [`14cf062`](https://github.com/digidem/styled-map-package/commit/14cf06279b934b6e8619e4772e21470ca9cc4d54) Thanks [@gmaclennan](https://github.com/gmaclennan)! - Add package READMEs

- [#79](https://github.com/digidem/styled-map-package/pull/79) [`5f23127`](https://github.com/digidem/styled-map-package/commit/5f23127b496791d79d195507f2142c4d6c7fc2b6) Thanks [@gmaclennan](https://github.com/gmaclennan)! - fix: Writer should not extend node EventEmitter

## 5.0.0-pre.0

### Major Changes

- [#72](https://github.com/digidem/styled-map-package/pull/72) [`9ec4b11`](https://github.com/digidem/styled-map-package/commit/9ec4b11e6ca254535b3d99714918e264837096d5) Thanks [@gmaclennan](https://github.com/gmaclennan)! - Restructure into npm workspaces monorepo with separate packages for the JS API (`styled-map-package-api`) and CLI (`styled-map-package`).
