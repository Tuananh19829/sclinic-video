import { store } from "../store";
import { h, I, clear } from "../ui/dom";
import { Viewer } from "../ui/viewer";
import { exportVideo, cancelExport, renderFramePNG } from "../engine/exporter";
import { fs, join } from "../ipc";
import { exportSRT } from "../actions";
import { timecode } from "../model";

interface Preset { id: string; name: string; sub: string; codec: string; ext: string; w?: number; h?: number; q?: number; tag: string }
const PRESETS: Preset[] = [
  { id: "yt1080", name: "YouTube 1080p", sub: "H.264 · CRF 18", codec: "h264", ext: "mp4", w: 1920, h: 1080, q: 18, tag: "YT" },
  { id: "yt4k", name: "YouTube 4K", sub: "H.265 · CRF 20", codec: "h265", ext: "mp4", w: 3840, h: 2160, q: 20, tag: "4K" },
  { id: "vertical", name: "TikTok / Reels / Shorts", sub: "1080×1920 · H.264", codec: "h264", ext: "mp4", w: 1080, h: 1920, q: 19, tag: "9:16" },
  { id: "custom", name: "Theo cài đặt timeline", sub: "Độ phân giải dự án · H.264", codec: "h264", ext: "mp4", q: 18, tag: "TL" },
  { id: "prores", name: "ProRes 422 HQ", sub: "Bản master · .mov", codec: "prores", ext: "mov", tag: "PR" },
  { id: "prores4444", name: "ProRes 4444 (alpha)", sub: "Đồ hoạ chuyển động có alpha", codec: "prores4444", ext: "mov", tag: "α" },
  { id: "webm", name: "WebM VP9 (alpha)", sub: "Lớp phủ cho web", codec: "vp9", ext: "webm", q: 30, tag: "VP9" },
  { id: "gif", name: "GIF động", sub: "Tối ưu bảng màu", codec: "gif", ext: "gif", tag: "GIF" },
];

export class DeliverPage {
  el: HTMLElement;
  private preset = PRESETS[3];
  private form: HTMLElement;
  private queue: HTMLElement;
  private name = "";
  private range: "all" | "inout" = "all";
  private busy = false;

  constructor(private viewer: Viewer) {
    this.form = h("div", { class: "body", style: { padding: "12px" } });
    this.queue = h("div", { class: "body" });
    const list = h("div", { class: "body" });
    for (const p of PRESETS) {
      const el = h("div", { class: "preset" + (p === this.preset ? " on" : ""), onclick: () => { this.preset = p; list.querySelectorAll(".preset").forEach((x) => x.classList.remove("on")); el.classList.add("on"); this.renderForm(); } },
        h("div", { class: "ic" }, p.tag), h("div", {}, h("div", { style: { fontWeight: 600 } }, p.name), h("div", { class: "faint", style: { fontSize: "11px" } }, p.sub)));
      list.appendChild(el);
    }
    this.el = h("div", { class: "page page-deliver" },
      h("div", { class: "panel" }, h("header", {}, h("h3", {}, "Cài đặt xuất")), list, this.form),
      h("div", { class: "p-viewer", style: { display: "flex", minHeight: "0" } }),
      h("div", { class: "panel" }, h("header", {}, h("h3", {}, "Hàng đợi xuất")), this.queue));
  }

  mount() {
    const slot = this.el.querySelector(".p-viewer") as HTMLElement;
    if (this.viewer.el.parentElement !== slot) slot.appendChild(this.viewer.el);
    this.viewer.el.style.flex = "1";
    this.viewer.mount();
    if (!this.name) this.name = (store.project.name || "export").replace(/[^\w\- ]+/g, "").trim() || "export";
    this.renderForm();
    void this.renderQueue();
  }

  private renderForm() {
    clear(this.form);
    const p = this.preset, s = store.project.settings;
    const name = h("input", { type: "text", value: this.name, style: { width: "100%" } }) as HTMLInputElement;
    name.addEventListener("input", () => (this.name = name.value));
    const rg = h("div", { class: "tabs" }, ...(["all", "inout"] as const).map((r) => h("button", { class: this.range === r ? "on" : "", onclick: () => { this.range = r; this.renderForm(); } }, r === "all" ? "Toàn bộ timeline" : "Vùng In/Out")));
    const W = p.w ?? s.width, H = p.h ?? s.height;
    const go = h("button", { class: "btn primary", style: { width: "100%", justifyContent: "center", padding: "10px" }, disabled: this.busy, onclick: () => this.render() }, I.deliver(), "Xuất");
    this.form.append(
      h("div", { class: "col" },
        h("label", { class: "faint" }, "Tên tệp"), name,
        h("label", { class: "faint" }, "Phạm vi"), rg,
        h("div", { class: "faint", style: { fontSize: "11.5px", lineHeight: 1.6 } },
          `Định dạng: ${p.codec.toUpperCase()} (.${p.ext})`, h("br"), `Độ phân giải: ${W}×${H}`, h("br"), `Tốc độ khung hình: ${s.fps} fps`, h("br"),
          `Thời lượng: ${timecode(this.span()[1] - this.span()[0], s.fps)}`, h("br"), `Đầu ra: renders/${this.name}.${p.ext}`),
        go,
        h("div", { class: "row" },
          h("button", { class: "btn sm", onclick: () => this.still() }, I.image(), "Ảnh tĩnh (PNG)"),
          h("button", { class: "btn sm", onclick: () => this.srt() }, I.caption(), "Phụ đề (.srt)"))));
  }

  private span(): [number, number] {
    return this.range === "inout" ? [store.inPoint ?? 0, store.outPoint ?? store.duration] : [0, store.duration];
  }

  private async render() {
    if (this.busy) return;
    this.busy = true;
    this.renderForm();
    const p = this.preset;
    const out = `renders/${this.name || "export"}.${p.ext}`;
    const item = h("div", { class: "queue-item" });
    const bar = h("i", { style: { width: "0%" } });
    const status = h("div", { class: "faint", style: { fontSize: "11px" } }, "Đang bắt đầu…");
    const cancel = h("button", { class: "btn sm danger", onclick: () => cancelExport() }, "Huỷ");
    item.append(h("div", { class: "row" }, h("b", { class: "grow" }, out), cancel), h("div", { class: "progress" }, bar), status);
    this.queue.prepend(item);
    const [from, to] = this.span();
    try {
      const t0 = performance.now();
      const abs = await exportVideo(this.viewer.renderer, { out, codec: p.codec, quality: p.q, from, to, width: p.w, height: p.h }, (pr) => {
        bar.style.width = `${(pr.frame / pr.total) * 100}%`;
        status.textContent = `${pr.stage} · khung ${pr.frame}/${pr.total} · ${pr.fps.toFixed(1)} fps · còn ${Math.ceil(pr.eta)}s`;
      });
      status.textContent = `Xong trong ${((performance.now() - t0) / 1000).toFixed(1)}s`;
      cancel.replaceWith(h("button", { class: "btn sm", onclick: () => fs.reveal(abs) }, I.reveal(), "Mở thư mục"));
      store.emit("toast", "Xuất xong");
    } catch (e: any) {
      status.textContent = "Thất bại: " + (e?.message ?? e);
      status.style.color = "var(--red)";
    } finally {
      this.busy = false;
      this.renderForm();
    }
  }

  private async still() {
    const png = await renderFramePNG(this.viewer.renderer, store.playhead, 1);
    const path = join(store.dir, "renders", `still_${timecode(store.playhead, store.fps).replace(/:/g, "-")}.png`);
    await fs.writeBytes(path, png);
    store.emit("toast", "Đã lưu " + store.rel(path));
    void this.renderQueue();
  }

  private async srt() {
    const path = join(store.dir, "renders", `${this.name || "subtitles"}.srt`);
    await fs.writeText(path, exportSRT());
    store.emit("toast", "Đã lưu " + store.rel(path));
    void this.renderQueue();
  }

  private async renderQueue() {
    const old = this.queue.querySelector(".history");
    old?.remove();
    const hist = h("div", { class: "history" }, h("div", { class: "lib-sec" }, "renders/"));
    try {
      const es = (await fs.list(join(store.dir, "renders"))).sort((a, b) => b.modified - a.modified);
      for (const e of es) hist.appendChild(h("div", { class: "lib-item", ondblclick: () => fs.reveal(e.path) },
        h("div", { class: "t" }, h("div", {}, e.name), h("small", {}, `${(e.size / 1048576).toFixed(1)} MB · ${new Date(e.modified * 1000).toLocaleString()}`))));
    } catch { /* */ }
    this.queue.appendChild(hist);
  }
}
