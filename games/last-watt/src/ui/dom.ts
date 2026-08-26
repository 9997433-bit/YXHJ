/**
 * 极小 DOM 工具。
 *
 * HUD 刻意不引框架：它一共十来个部件，每帧只改几个数字，
 * 一层虚拟 DOM 的开销和心智成本都比它自己大。
 * 代价是必须手动做「值没变就不写 DOM」，这一条由 `bindText` 之类的小工具兜住。
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  ...children: (Node | string | null | undefined)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  for (const child of children) {
    if (child === null || child === undefined) continue;
    node.append(child);
  }
  return node;
}

export function svg<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number> = {},
  ...children: Node[]
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) {
    node.setAttribute(key, String(value));
  }
  for (const child of children) node.append(child);
  return node;
}

/** 只在文本真的变了时才写 DOM，避免每帧触发无谓的重排。 */
export function setText(node: { textContent: string | null }, value: string): void {
  if (node.textContent !== value) node.textContent = value;
}

export function setClass(node: Element, className: string, on: boolean): void {
  if (node.classList.contains(className) === on) return;
  node.classList.toggle(className, on);
}

export function setAttr(node: Element, name: string, value: string): void {
  if (node.getAttribute(name) !== value) node.setAttribute(name, value);
}

export function setStyle(node: HTMLElement, prop: string, value: string): void {
  if (node.style.getPropertyValue(prop) !== value) node.style.setProperty(prop, value);
}

/** 重新触发一次 CSS 动画（缺口警红闪 2 次这类一次性反馈要用）。 */
export function restartAnimation(node: HTMLElement): void {
  const previous = node.style.animationName;
  node.style.animationName = 'none';
  // 强制回流，否则浏览器会把「关掉再打开」合并成没变化
  void node.offsetWidth;
  node.style.animationName = previous;
}
