// Preserve open sections and other forms' unsaved input during background swaps.
const dirtyControls = new WeakSet();
for (const type of ["change", "input"]) {
  document.addEventListener(type, (event) => {
    if (event.target.matches("input:not([type=hidden]), select, textarea") && event.target.form?.id)
      dirtyControls.add(event.target);
  });
}
document.addEventListener("htmx:beforeSwap", (event) => {
  const { target, requestConfig } = event.detail;
  const template = document.createElement("template");
  template.innerHTML = event.detail.serverResponse;
  target.querySelectorAll("details[open][id]").forEach((element) => {
    const replacement = template.content.getElementById(element.id);
    if (replacement) replacement.open = true;
  });
  // Stable region IDs also preserve keyboard focus on summaries and actions.
  const active = document.activeElement;
  if (active && target.contains(active)) {
    const anchor = active.closest("[id]");
    const path = [];
    let current = active;
    while (anchor && current !== anchor) {
      path.unshift([...current.parentElement.children].indexOf(current));
      current = current.parentElement;
    }
    let replacement = anchor && template.content.getElementById(anchor.id);
    for (const index of path) replacement = replacement?.children[index];
    if (
      replacement?.tagName === active.tagName &&
      replacement.getAttribute("name") === active.getAttribute("name") &&
      !replacement.hasAttribute("disabled")
    ) {
      replacement.setAttribute("data-poll-focus", "");
    }
  }
  const submitted = requestConfig?.verb === "post" ? requestConfig.elt?.closest("form") : undefined;
  target.querySelectorAll("form[id]").forEach((form) => {
    if (form === submitted) return;
    const replacement = template.content.getElementById(form.id);
    if (!replacement) return;
    for (const control of form.elements) {
      if (!dirtyControls.has(control)) continue;
      const controls = [...replacement.elements].filter(
        (next) => next.name === control.name && next.type === control.type,
      );
      const next =
        control.type === "checkbox" || control.type === "radio"
          ? controls.find((item) => item.value === control.value)
          : controls[0];
      if (!next) continue;
      if (control.type === "checkbox" || control.type === "radio") {
        next.toggleAttribute("checked", control.checked);
      } else if (next.tagName === "SELECT") {
        for (const option of next.options)
          option.toggleAttribute(
            "selected",
            [...control.selectedOptions].some((selected) => selected.value === option.value),
          );
      } else if (next.tagName === "TEXTAREA") {
        next.textContent = control.value;
      } else {
        next.setAttribute("value", control.value);
      }
      // Dirty markers survive serialisation without storing the draft anywhere else.
      next.setAttribute("data-unsaved", "");
      if (control === document.activeElement) {
        next.setAttribute(
          "data-draft-focus",
          JSON.stringify([control.selectionStart, control.selectionEnd]),
        );
      }
    }
  });
  event.detail.serverResponse = template.innerHTML;
});
document.addEventListener("htmx:afterSwap", () => {
  document.querySelectorAll("form[id] [data-unsaved]").forEach((control) => {
    dirtyControls.add(control);
    control.removeAttribute("data-unsaved");
    if (control.hasAttribute("data-draft-focus")) {
      const [start, end] = JSON.parse(control.getAttribute("data-draft-focus"));
      control.removeAttribute("data-draft-focus");
      control.focus({ preventScroll: true });
      if (start !== null && start !== undefined && control.setSelectionRange)
        control.setSelectionRange(start, end);
    }
  });
});

// Restore after draft values, using the replacement region rather than the old node.
document.addEventListener("htmx:afterSwap", () => {
  const focused = document.querySelector("[data-poll-focus]");
  if (!focused) return;
  focused.removeAttribute("data-poll-focus");
  focused.focus({ preventScroll: true });
});
