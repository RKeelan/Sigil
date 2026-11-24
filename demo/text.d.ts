// Markdown files are imported as their text.
declare module "*.md" {
  const text: string;
  export default text;
}
