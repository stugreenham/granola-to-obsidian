// Verbatim from https://github.com/tomelliot/obsidian-granola-sync (MIT)

export function convertHtmlToMarkdown(html: string): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  const output = processChildren(doc.body, 0);
  return output.replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

function processChildren(element: Node, indentLevel: number): string {
  let result = "";
  for (const child of Array.from(element.childNodes)) {
    result += processNode(child, indentLevel);
  }
  return result;
}

function processNode(node: Node, indentLevel: number): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent || "";
  if (node.nodeType !== Node.ELEMENT_NODE) return "";

  const el = node as HTMLElement;
  const tag = el.tagName.toLowerCase();

  switch (tag) {
    case "h1":
    case "h2":
    case "h3":
    case "h4":
    case "h5":
    case "h6": {
      const level = parseInt(tag.charAt(1), 10);
      return `${"#".repeat(level)} ${getInlineContent(el).trim()}\n\n`;
    }
    case "p":
      return getInlineContent(el) + "\n\n";
    case "ul":
      return processListItems(el, indentLevel) + "\n\n";
    case "ol":
      return processOrderedListItems(el, indentLevel) + "\n\n";
    case "br":
      return "\n";
    case "strong":
    case "b":
      return `**${getInlineContent(el)}**`;
    case "em":
    case "i":
      return `*${getInlineContent(el)}*`;
    case "a": {
      const href = el.getAttribute("href") || "";
      return `[${getInlineContent(el)}](${href})`;
    }
    case "code":
      return `\`${el.textContent || ""}\``;
    case "pre":
      return `\`\`\`\n${el.textContent || ""}\n\`\`\`\n\n`;
    case "blockquote": {
      const content = processChildren(el, indentLevel).trim();
      return content.split("\n").map((line) => `> ${line}`).join("\n") + "\n\n";
    }
    default:
      return processChildren(el, indentLevel);
  }
}

function getInlineContent(el: HTMLElement): string {
  let result = "";
  for (const child of Array.from(el.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      result += child.textContent || "";
    } else if (child.nodeType === Node.ELEMENT_NODE) {
      const childEl = child as HTMLElement;
      const tag = childEl.tagName.toLowerCase();
      switch (tag) {
        case "strong":
        case "b":
          result += `**${getInlineContent(childEl)}**`;
          break;
        case "em":
        case "i":
          result += `*${getInlineContent(childEl)}*`;
          break;
        case "a":
          result += `[${getInlineContent(childEl)}](${childEl.getAttribute("href") || ""})`;
          break;
        case "code":
          result += `\`${childEl.textContent || ""}\``;
          break;
        case "br":
          result += "\n";
          break;
        default:
          result += getInlineContent(childEl);
      }
    }
  }
  return result;
}

function processListItems(ul: HTMLElement, indentLevel: number): string {
  const items: string[] = [];
  for (const child of Array.from(ul.children)) {
    if (child.tagName.toLowerCase() !== "li") continue;
    const indent = "\t".repeat(indentLevel);
    const parts: string[] = [];
    let nested = "";
    for (const liChild of Array.from(child.childNodes)) {
      if (liChild.nodeType === Node.TEXT_NODE) {
        const text = (liChild.textContent || "").trim();
        if (text) parts.push(text);
      } else if (liChild.nodeType === Node.ELEMENT_NODE) {
        const liEl = liChild as HTMLElement;
        const tag = liEl.tagName.toLowerCase();
        if (tag === "ul") nested += "\n" + processListItems(liEl, indentLevel + 1);
        else if (tag === "ol") nested += "\n" + processOrderedListItems(liEl, indentLevel + 1);
        else parts.push(getInlineContent(liEl));
      }
    }
    items.push(`${indent}- ${parts.join(" ").trim()}${nested}`);
  }
  return items.join("\n");
}

function processOrderedListItems(ol: HTMLElement, indentLevel: number): string {
  const items: string[] = [];
  let index = 1;
  for (const child of Array.from(ol.children)) {
    if (child.tagName.toLowerCase() !== "li") continue;
    const indent = "\t".repeat(indentLevel);
    const parts: string[] = [];
    let nested = "";
    for (const liChild of Array.from(child.childNodes)) {
      if (liChild.nodeType === Node.TEXT_NODE) {
        const text = (liChild.textContent || "").trim();
        if (text) parts.push(text);
      } else if (liChild.nodeType === Node.ELEMENT_NODE) {
        const liEl = liChild as HTMLElement;
        const tag = liEl.tagName.toLowerCase();
        if (tag === "ul") nested += "\n" + processListItems(liEl, indentLevel + 1);
        else if (tag === "ol") nested += "\n" + processOrderedListItems(liEl, indentLevel + 1);
        else parts.push(getInlineContent(liEl));
      }
    }
    items.push(`${indent}${index}. ${parts.join(" ").trim()}${nested}`);
    index++;
  }
  return items.join("\n");
}
