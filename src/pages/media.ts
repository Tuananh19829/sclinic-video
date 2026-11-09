import { store } from "../store";
import { h, I, clear, prompt, menu } from "../ui/dom";
import { mediaCard, pickAndImport } from "../ui/library";
import { fs, join, mediaUrl, ext, basename, IMAGE_EXT, VIDEO_EXT, AUDIO_EXT, DirEntry } from "../ipc";
import { Media, timecode } from "../model";
import * as act from "../actions";
import { importFiles } from "../media";
import { open } from "@tauri-apps/plugin-dialog";

export class MediaPage {
  el: HTMLElement;
  private folder = "pool";
  private side: HTMLElement;
  private center: HTMLElement;
  private right: HTMLElement;
  private sel: Media | null = null;
  private srcIn = 0; private srcOut: number | null = null;

  constructor() {
    this.side = h("div", { class: "body" });
    this.center = h("div", { class: "body" });
    this.right = h("div", { class: "body" });
    this.el = h("div", { class: "page page-media" },
      h("div", { class: "panel" }, h("header", {}, h("h3", {}, "Thư viện")), this.side),
      h("div", { class: "panel" }, h("header", {}, h("h3", { id: "media-title" }, "Kho media"), h("div", { class: "grow" }),
        h("button", { class: "btn sm", onclick: () => this.addInspo() }, I.heart(), "Thêm cảm hứng"),
        h("button", { class: "btn sm primary", onclick: () => pickAndImport() }, I.import(), "Nhập media")), this.center),
      h("div", { class: "panel" }, h("header", {}, h("h3", {}, "Nguồn")), this.right));
    store.on("project", (w) => { if (w !== "drag" && w !== "trim" && w !== "inspector") this.render(); });
    store.on("thumbs", () => this.folder === "pool" && this.renderCenter());
    store.on("files", () => this.folder !== "pool" && this.renderCenter());
  }

  render() { this.renderSide(); void this.renderCenter(); this.renderRight(); }

  private renderSide() {
    clear(this.side);
    const item = (id: string, label: string, icon: SVGElement, sub: string) => {
      const el = h("div", { class: "lib-item" + (this.folder === id ? " sel" : ""), onclick: () => { this.folder = id; this.render(); } },
        h("div", { class: "sw", style: { display: "grid", placeItems: "center", background: "var(--fill-2)" } }, icon), h("div", { class: "t" }, h("div", {}, label), h("small", {}, sub)));
      (el.querySelector("svg") as SVGElement).style.cssText = "width:14px;height:14px";
      return el;
    };
    this.side.append(h("div", { class: "lib-sec" }, "Dự án"),
      item("pool", "Kho media", I.film(), `${store.project.media.length} mục`),
      item("media", "media/", I.folder(), "tệp dự án"),
      item("inspo", "Cảm hứng", I.heart(), "inspo/ — tư liệu tham khảo cho agent"),
      item("renders", "Bản xuất", I.deliver(), "renders/"),
      item("motion", "Module chuyển động", I.motion(), "motion/"),
      h("div", { class: "lib-sec" }, "Tuỳ chọn"),
      h("label", { class: "row", style: { padding: "6px 16px", fontSize: "12px" } },
        h("input", { type: "checkbox", checked: localStorage.getItem("shdw.copyMedia") === "1", onchange: (e: any) => localStorage.setItem("shdw.copyMedia", e.target.checked ? "1" : "0") }),
        "Sao chép tệp được nhập vào media/"),
      h("div", { class: "faint", style: { padding: "4px 16px", fontSize: "11px" } }, "Mẹo: kéo tệp từ Explorer thả vào bất kỳ đâu trên cửa sổ để nhập."));
  }

  private async renderCenter() {
    clear(this.center);
    const title = document.getElementById("media-title");
    if (this.folder === "pool") {
      if (title) title.textContent = "Kho media";
      const p = store.project;
      if (!p.media.length) { this.center.appendChild(h("div", { class: "empty" }, h("div", {}, h("b", {}, "Kho media đang trống"), "Nhập video, nhạc và ảnh — hoặc thả chúng vào cửa sổ."))); return; }
      const grid = h("div", { class: "pool" });
      for (const m of p.media) { const c = mediaCard(m, (mm) => { this.sel = mm; this.srcIn = 0; this.srcOut = null; this.renderRight(); grid.querySelectorAll(".mcard").forEach((x) => x.classList.remove("sel")); c.classList.add("sel"); }); if (this.sel?.id === m.id) c.classList.add("sel"); grid.appendChild(c); }
      this.center.appendChild(grid);
      return;
    }
    if (title) title.textContent = this.folder + "/";
    let entries: DirEntry[] = [];
    try { entries = (await fs.list(join(store.dir, this.folder))).filter((e) => !e.name.startsWith(".")); } catch { /* */ }
    if (!entries.length) {
      this.center.appendChild(h("div", { class: "empty" }, h("div", {}, h("b", {}, "Chưa có gì ở đây"),
        this.folder === "inspo" ? "Thu thập ảnh tham khảo, video, bảng màu và ghi chú. Agent sẽ đọc thư mục này khi bạn yêu cầu bắt chước một phong cách." : "")));
      return;
    }
    const grid = h("div", { class: "pool" });
    for (const e of entries.sort((a, b) => b.modified - a.modified)) grid.appendChild(this.fileCard(e));
    this.center.appendChild(grid);
  }

  private fileCard(e: DirEntry) {
    const x = ext(e.name);
    const isImg = IMAGE_EXT.includes(x), isVid = VIDEO_EXT.includes(x), isAud = AUDIO_EXT.includes(x);
    const th = h("div", { class: "th", style: isImg ? { backgroundImage: `url("${mediaUrl(e.path)}")` } : {} });
    if (isVid) { const v = h("video", { src: mediaUrl(e.path), muted: true, preload: "metadata", crossOrigin: "anonymous" }) as HTMLVideoElement; v.addEventListener("mouseenter", () => v.play()); v.addEventListener("mouseleave", () => v.pause()); th.appendChild(v); }
    if (!isImg && !isVid) th.appendChild(h("div", { style: { padding: "10px", fontSize: "11px", color: "var(--label-3)" } }, isAud ? "♪ âm thanh" : x === "md" || x === "txt" ? "ghi chú" : x));
    if (x === "md" || x === "txt") void fs.readText(e.path).then((t) => { th.textContent = t.slice(0, 160); Object.assign(th.style, { padding: "10px", fontSize: "11px", color: "var(--label-2)", alignItems: "start", display: "block", overflow: "hidden" }); });
    const card = h("div", { class: "mcard", title: e.path }, th, h("div", { class: "nm" }, e.name, h("small", {}, `${(e.size / 1024 / 1024).toFixed(1)} MB`)));
    card.addEventListener("dblclick", () => { if (isImg || isVid || isAud) void importFiles([e.path]); });
    card.addEventListener("contextmenu", (ev) => {
      ev.preventDefault();
      menu(ev.clientX, ev.clientY, [
        ...(isImg || isVid || isAud ? [{ label: "Nhập vào kho media", action: () => void importFiles([e.path]) }] : []),
        { label: "✦ Dùng làm tham khảo cho agent", action: () => store.emit("agent-attach", store.rel(e.path)) },
        { label: "Hiện trong Explorer", action: () => fs.reveal(e.path) },
        { sep: true },
        { label: "Xoá tệp", action: async () => { await fs.remove(e.path); this.renderCenter(); } },
      ]);
    });
    return card;
  }

  private async addInspo() {
    const choice = await new Promise<string>((res) => {
      const r = document.activeElement as HTMLElement;
      const rect = (r?.getBoundingClientRect?.() ?? { left: 400, bottom: 120 }) as DOMRect;
      menu(rect.left, rect.bottom + 4, [
        { label: "Thêm tệp (ảnh / video)…", action: () => res("files") },
        { label: "Thêm ghi chú hoặc liên kết…", action: () => res("note") },
      ]);
    });
    if (choice === "files") {
      const sel = await open({ multiple: true, title: "Thêm cảm hứng" });
      if (!sel) return;
      for (const p of (Array.isArray(sel) ? sel : [sel]).map(String)) await fs.copy(p, join(store.dir, "inspo", basename(p)));
    } else {
      const text = await prompt("Ghi chú hoặc liên kết cảm hứng", "", "vd: phong cách keynote Apple, đẩy máy chậm, https://…");
      if (!text) return;
      await fs.writeText(join(store.dir, "inspo", `note-${Date.now().toString(36)}.md`), text);
    }
    this.folder = "inspo";
    this.render();
  }

  private renderRight() {
    clear(this.right);
    const m = this.sel;
    if (!m) { this.right.appendChild(h("div", { class: "empty" }, "Chọn một clip trong kho để xem trước, đánh dấu In/Out và đưa vào timeline.")); return; }
    const url = mediaUrl(store.abs(m.proxy ?? m.path));
    const el = m.kind === "image" ? h("img", { src: url, style: { width: "100%", display: "block", background: "#000" } })
      : h(m.kind === "audio" ? "audio" : "video", { src: url, controls: true, crossOrigin: "anonymous", style: { width: "100%", display: "block", background: "#000", maxHeight: "300px" } }) as HTMLVideoElement;
    const io = h("div", { class: "row", style: { padding: "10px", flexWrap: "wrap" } });
    const paint = () => {
      clear(io);
      io.append(
        h("button", { class: "btn sm", onclick: () => { this.srcIn = (el as HTMLVideoElement).currentTime ?? 0; paint(); } }, "Đặt In"),
        h("button", { class: "btn sm", onclick: () => { this.srcOut = (el as HTMLVideoElement).currentTime ?? null; paint(); } }, "Đặt Out"),
        h("span", { class: "faint" }, `${timecode(this.srcIn, m.fps ?? 30)} → ${timecode(this.srcOut ?? m.duration, m.fps ?? 30)}`));
    };
    paint();
    this.right.append(el, io,
      h("div", { class: "row", style: { padding: "0 10px 10px" } },
        h("button", { class: "btn sm primary", onclick: () => act.placeMedia(m, store.duration, undefined, this.srcIn, this.srcOut ?? undefined) }, "Thêm vào cuối timeline"),
        h("button", { class: "btn sm", onclick: () => act.placeMedia(m, store.playhead, undefined, this.srcIn, this.srcOut ?? undefined) }, "Chèn tại đầu phát")),
      h("div", { class: "insp" }, ...Object.entries({ "Tên": m.name, "Loại": m.kind, "Thời lượng": `${m.duration.toFixed(2)} s`, "Độ phân giải": m.width ? `${m.width}×${m.height}` : "—", "Tốc độ khung hình": m.fps ?? "—", Codec: m.codec ?? "—", "Âm thanh": m.hasAudio ? "có" : "không", "Đã tối ưu": m.proxy ? "có" : "không", "Đường dẫn": m.path, ID: m.id })
        .map(([k, v]) => h("div", { class: "field", style: { padding: "0 12px" } }, h("label", {}, k), h("div", { class: "ctl", style: { userSelect: "text", overflow: "hidden", textOverflow: "ellipsis" } }, String(v)), h("span")))));
  }
}
