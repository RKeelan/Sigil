import basics from "./samples/basics.md" with { type: "text" };
import changesHead from "./samples/changes.head.md" with { type: "text" };
import changesIndex from "./samples/changes.index.md" with { type: "text" };
import changes from "./samples/changes.md" with { type: "text" };
import code from "./samples/code.md" with { type: "text" };
import frontMatter from "./samples/front-matter.md" with { type: "text" };
import lists from "./samples/lists.md" with { type: "text" };
import longLines from "./samples/long-lines.md" with { type: "text" };
import tables from "./samples/tables.md" with { type: "text" };

/** A document the demo can load: its text, and the committed and staged texts if they differ. */
export interface Sample {
  name: string;
  title: string;
  text: string;
  head?: string;
  index?: string;
}

const words =
  "the of and a to in is was that it for on with as his her at by this had not but from they she he or an were which there been their one all would when we no out so up into them then some could time very only more these two may its over made after did many before must through years where much way well down should because each just those people how too little state good world still own see men work long here get both between life being under never day same another know while last might us great old year off come since against go came right used take three";

/**
 * A long manuscript, to see how the editor holds up on a novel kept in one file. The text is
 * generated, and is the same every time.
 */
function manuscript(): string {
  const list = words.split(" ");
  let seed = 20260115;
  // Mulberry32.
  const random = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const word = () => list[Math.floor(random() * list.length)] as string;
  const sentence = () => {
    const length = 6 + Math.floor(random() * 16);
    const parts: string[] = [];
    for (let i = 0; i < length; i++) {
      let next = word();
      const roll = random();
      if (roll < 0.015) next = `*${next}*`;
      else if (roll < 0.02) next = `**${next}**`;
      if (i > 2 && i < length - 2 && random() < 0.08) next += ",";
      parts.push(next);
    }
    const text = parts.join(" ");
    return `${text.charAt(0).toUpperCase()}${text.slice(1)}.`;
  };
  const paragraph = () => {
    const sentences: string[] = [];
    const count = 2 + Math.floor(random() * 6);
    for (let i = 0; i < count; i++) sentences.push(sentence());
    return sentences.join(" ");
  };
  const out: string[] = ["# A Long Manuscript", ""];
  for (let chapter = 1; chapter <= 40; chapter++) {
    out.push(`## Chapter ${chapter}`, "");
    for (let i = 0; i < 48; i++) {
      if (i > 0 && i % 16 === 0) out.push("***", "");
      out.push(random() < 0.15 ? `“${sentence()}”` : paragraph(), "");
    }
  }
  return out.join("\n");
}

export const samples: Sample[] = [
  { name: "basics", title: "Basics", text: basics },
  { name: "lists", title: "Lists", text: lists },
  { name: "tables", title: "Tables", text: tables },
  { name: "code", title: "Code", text: code },
  { name: "front-matter", title: "Front matter", text: frontMatter },
  { name: "long-lines", title: "Long lines", text: longLines },
  {
    name: "changes",
    title: "Changes",
    text: changes,
    head: changesHead,
    index: changesIndex,
  },
  { name: "manuscript", title: "Manuscript", text: manuscript() },
];
