// Minimal editor host; real Pi TUI helpers are used by the integration tests.
export class CustomEditor {
  static autocomplete = [];

  constructor() {
    this.borderColor = (text) => text;
  }

  render(width) {
    if (width <= 0) return [];
    return [this.borderColor(""), "prompt".slice(0, width), this.borderColor(""), ...CustomEditor.autocomplete];
  }
}
