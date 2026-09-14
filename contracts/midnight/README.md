# contracts/midnight

Compact smart contracts for CoinDraft's Midnight integration — a separate project from `contracts/` (0G/Hardhat), its own toolchain.

## Editor setup

VS Code has no built-in `.compact` syntax highlighting. The official extension, **Compact Language Support** v0.2.13, isn't on the Marketplace — it's a manual VSIX install:

1. Download: `https://raw.githubusercontent.com/midnight-ntwrk/releases/gh-pages/artifacts/vscode-extension/compact-0.2.13/compact-0.2.13.vsix`
2. VS Code → Extensions panel → `...` menu → **Install from VSIX** → select the downloaded file

## Run the tests

```bash
npm install
npm test
```
