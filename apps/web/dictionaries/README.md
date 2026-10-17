# Spell-checking dictionaries

| Language | Source | License |
|---|---|---|
| Uzbek (Cyrillic) `uz-Cyrl.dic` | [uzbek-wordlist](https://github.com/kmashrab/uzbek-wordlist) by Mashrab Kuvatov, as packaged by Debian (`hunspell-uz` 0.6-7) | GPL-2.0-or-later, see `uz-Cyrl.copyright` |
| Uzbek (Latin) | generated from the Cyrillic list by `scripts/build-dictionaries.mjs` (official Cyrillic → Latin transliteration) | GPL-2.0-or-later (derived work) |
| Russian | npm `dictionary-ru` | BSD-3-Clause |
| English (US) | npm `dictionary-en` | MIT AND BSD |

The dictionaries are data files loaded by the browser's spell-check worker;
they are copied (and the Latin list generated) into `public/dict/` by
`npm run dictionaries`, which runs automatically before `dev` and `build`.
