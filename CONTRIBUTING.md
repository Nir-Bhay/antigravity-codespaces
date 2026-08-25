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
   - [Node.js](https://nodejs.org/) (v18 or newer)
   - [GitHub CLI](https://cli.github.com/) (`gh`) authenticated with Codespace scope:
     ```bash
     gh auth login -s codespace
     ```
   - [Antigravity IDE](https://github.com/) or any Code-OSS environment.

3. **Validate Code:**
   ```bash
   node -c extension.js
   ```

4. **Package VSIX Locally:**
   ```bash
   npx @vscode/vsce package --no-git-tag-version --allow-missing-repository --skip-license
   ```

5. **Install and Test in IDE:**
   ```bash
   antigravity-ide --install-extension antigravity-codespaces-4.3.0.vsix --force
   ```

---

## 📬 Submitting Changes

1. Fork the repo and create a new feature branch (`git checkout -b feature/amazing-feature`).
2. Follow clean code and humanizer principles.
3. Verify changes with `node -c extension.js`.
4. Submit a Pull Request describing your changes.

---

## 📄 License
By contributing, you agree that your contributions will be licensed under the project's [MIT License](LICENSE).
