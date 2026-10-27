# Contributing to Antigravity Codespaces Pro

Thank you for your interest in contributing to **Antigravity Codespaces Pro**!

---

## 🛠️ Local Development Setup

1. **Clone the repository:**
   ```bash
   git clone https://github.com/Nir-Bhay/antigravity-codespaces.git
   cd antigravity-codespaces
   ```

2. **Prerequisites:**
   - [Node.js](https://nodejs.org/) 20 or newer (required by the MCP server and its test suite)
   - [GitHub CLI](https://cli.github.com/) (`gh`) authenticated with Codespace scope:
     ```bash
     gh auth login -s codespace
     ```
   - [Antigravity IDE](https://github.com/) or any Code-OSS environment.

3. **Run automated checks:**
   ```bash
   npm test
   npm run check
   node --check mcp-server/index.mjs
   ```

   `npm test` runs the extension and MCP server test suites. These tests use local fixtures/mocks; they do not start a live Codespace.

4. **Package the extension locally (optional):**
   ```bash
   npx @vscode/vsce package --no-git-tag-version --allow-missing-repository --skip-license -o antigravity-codespaces-dev.vsix
   ```

5. **Install and Test in IDE:**
   ```bash
   antigravity-ide --install-extension antigravity-codespaces-dev.vsix --force
   # or: code / cursor / windsurf --install-extension antigravity-codespaces-dev.vsix --force
   ```

---

## 📬 Submitting Changes

1. Fork the repo and create a new feature branch (`git checkout -b feature/amazing-feature`).
2. Follow the existing style and keep changes focused.
3. Run the relevant automated checks above. For connection or lifecycle changes, describe which live editor/Codespace scenarios you did and did not verify.
4. Submit a Pull Request describing user impact, security/cost implications, checks run, and remaining limitations.

---

## 📄 License
By contributing, you agree that your contributions will be licensed under the project's [MIT License](LICENSE).
