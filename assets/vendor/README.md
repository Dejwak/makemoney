# Knihovny třetích stran

| Soubor | Projekt | Verze | Licence |
| --- | --- | --- | --- |
| `qrcode.mjs` | [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) (Kazuhiko Arase) | 2.0.4 | MIT |
| `pdf-lib.min.js` | [pdf-lib](https://github.com/Hopding/pdf-lib) | 1.17.1 | MIT |
| `fontkit.umd.min.js` | [@pdf-lib/fontkit](https://github.com/Hopding/fontkit) | 1.1.1 | MIT |

Písma v `assets/fonts` (IBM Plex Sans, JetBrains Mono, Bricolage Grotesque) jsou pod licencí
SIL Open Font License 1.1, texty licencí leží vedle nich.

„QR Code“ je registrovaná ochranná známka společnosti DENSO WAVE INCORPORATED.

`pdf-lib.min.js` a `fontkit.umd.min.js` jsou oproti distribuci převedené do čistého ASCII
(znaky mimo ASCII a řídicí znaky v řetězcích jsou zapsané jako `\uXXXX` / `\xNN`). Chování
se nemění, jen jdou soubory publikovat i tam, kde hosting takové znaky ve zdrojáku odmítá.
