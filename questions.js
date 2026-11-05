// The 25 situations. PLACEHOLDERS for now — replace with the real ones.
// Each: title, story (paragraphs), question, options A–D.
window.SITUATIONS = Array.from({ length: 25 }, (_, i) => ({
  id: i + 1,
  title: `Situation ${i + 1} title goes here`,
  story: [
    "Placeholder story text. The real situation will be written here.",
    "Each paragraph is one line in this list.",
  ],
  question: "What would you do?",
  options: [
    { key: "A", text: "Placeholder answer A." },
    { key: "B", text: "Placeholder answer B." },
    { key: "C", text: "Placeholder answer C." },
    { key: "D", text: "Placeholder answer D." },
  ],
}));
