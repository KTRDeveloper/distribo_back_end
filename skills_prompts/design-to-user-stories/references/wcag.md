# WCAG 2.2, level AA (user interfaces)

Open when the design includes a user interface. Target level AA unless the design states otherwise. Each UI story adds the criteria it touches as acceptance criteria or tests (automated checks with the stack's accessibility test tool when it is in the allowlist, otherwise explicit assertions on roles, names and focus).

| criterion | what the stories must do |
|---|---|
| 1.1.1 Non-text Content (A) | every image or icon that conveys meaning has a text alternative; decorative ones are hidden from assistive technology |
| 1.3.1 Info and Relationships (A) | headings, lists, tables and form labels use semantic markup, not visual styling only |
| 1.4.3 Contrast (Minimum) (AA) | text contrast at least 4.5:1 (3:1 for large text) |
| 1.4.10 Reflow (AA) and 1.4.4 Resize Text (AA) | usable at 320 CSS px wide and at 200% text size without loss of content |
| 1.4.11 Non-text Contrast (AA) | controls and focus indicators at least 3:1 against their background |
| 2.1.1 Keyboard (A) | every action works with the keyboard alone |
| 2.4.3 Focus Order (A), 2.4.7 Focus Visible (AA) | logical focus order and a visible focus indicator |
| 2.4.11 Focus Not Obscured (Minimum) (AA) | a focused control is never hidden by sticky headers, banners or dialogs |
| 2.5.7 Dragging Movements (AA) | every drag action has a single-pointer alternative |
| 2.5.8 Target Size (Minimum) (AA) | pointer targets at least 24 by 24 CSS px, or spaced enough |
| 3.1.1 Language of Page (A) | the page language is set; 3.1.2 for passages in another language |
| 3.3.1 Error Identification (A), 3.3.3 Error Suggestion (AA) | errors are described in text next to the field, with how to fix them |
| 3.3.2 Labels or Instructions (A) | every input has a visible label |
| 3.3.7 Redundant Entry (A) | information already entered in the same process is not asked again |
| 3.3.8 Accessible Authentication (Minimum) (AA) | no cognitive test to log in; paste and password managers allowed (also ASVS v5.0.0-6.2.7) |
| 4.1.2 Name, Role, Value (A) | custom controls expose name, role and state to assistive technology |
| 4.1.3 Status Messages (AA) | status updates (saved, error, loading) are announced without moving focus |
