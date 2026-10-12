import { useEffect, useId, useRef, type RefObject } from "react";
import {
  ACESFilmicToneMapping,
  Box3,
  DirectionalLight,
  Group,
  HemisphereLight,
  Mesh,
  OrthographicCamera,
  Quaternion,
  Scene,
  SRGBColorSpace,
  Texture,
  Vector3,
  WebGLRenderer,
  type BufferGeometry,
  type Material,
  type Object3D,
} from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { reconcileGunSlots, type GunPlayer, type GunSlot } from "./gunState";
import "./gun-table.css";

interface GunTableProps {
  players: readonly GunPlayer[];
  gunSupply: number;
  syncKey: string;
  theme: "dark" | "light";
  tableRef: RefObject<HTMLDivElement | null>;
}

type Point = { x: number; y: number };
type Rect = Point & { width: number; height: number };
type Pose = { position: Vector3; rotation: Quaternion; scale: number };
type GunVisual = {
  slot: GunSlot;
  model: Object3D;
  marker: HTMLSpanElement;
  line: SVGLineElement;
  dot: SVGCircleElement;
  from: Pose;
  to: Pose;
  startedAt: number;
  moving: boolean;
  endpoint: Point | null;
};
type Runtime = { update: (props: GunTableProps) => void; dispose: () => void };

const MOVE_MS = 500;
const SVG_NS = "http://www.w3.org/2000/svg";
const Z_AXIS = new Vector3(0, 0, 1);
const TOP_VIEW = new Quaternion().setFromAxisAngle(
  new Vector3(1, 0, 0),
  Math.PI / 2,
);

function snapshotKey(props: GunTableProps) {
  return JSON.stringify([
    props.syncKey,
    props.gunSupply,
    props.players.map(({ id, alive, armed, aimingAt }) => [
      id,
      alive,
      armed,
      aimingAt,
    ]),
  ]);
}

// Read the existing motion token so DOM transitions and 3D movement agree.
function movementEasing(table: HTMLElement): (progress: number) => number {
  const token = getComputedStyle(table).getPropertyValue("--ease-in-out");
  const values = token
    .match(/cubic-bezier\(([^)]+)\)/)?.[1]
    .split(",")
    .map(Number);
  const [x1, y1, x2, y2] =
    values?.length === 4 && values.every(Number.isFinite)
      ? values
      : [0.77, 0, 0.175, 1];
  const curve = (t: number, a: number, b: number) =>
    3 * (1 - t) ** 2 * t * a + 3 * (1 - t) * t ** 2 * b + t ** 3;
  return (progress) => {
    if (progress <= 0 || progress >= 1) return progress;
    let low = 0;
    let high = 1;
    for (let i = 0; i < 16; i += 1) {
      const middle = (low + high) / 2;
      if (curve(middle, x1, x2) < progress) low = middle;
      else high = middle;
    }
    return curve((low + high) / 2, y1, y2);
  };
}

function disposeAsset(root: Object3D) {
  const geometries = new Set<BufferGeometry>();
  const materials = new Set<Material>();
  const textures = new Set<Texture>();
  root.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    geometries.add(object.geometry);
    const list = Array.isArray(object.material)
      ? object.material
      : [object.material];
    for (const material of list) {
      materials.add(material);
      for (const value of Object.values(material)) {
        if (value instanceof Texture) textures.add(value);
      }
    }
  });
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) material.dispose();
  for (const texture of textures) {
    const image = texture.source.data;
    texture.dispose();
    if (typeof ImageBitmap !== "undefined" && image instanceof ImageBitmap) {
      image.close();
    }
  }
}

function svgElement<K extends keyof SVGElementTagNameMap>(
  name: K,
  attributes: Record<string, string | number> = {},
): SVGElementTagNameMap[K] {
  const element = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attributes)) {
    element.setAttribute(key, String(value));
  }
  return element;
}

function outsideSeat(target: Point, from: Point, seat: Rect): Point {
  const dx = from.x - target.x;
  const dy = from.y - target.y;
  const padding = 6;
  const x =
    Math.abs(dx) < 0.001
      ? Infinity
      : ((dx > 0 ? seat.x + seat.width + padding : seat.x - padding) -
          target.x) /
        dx;
  const y =
    Math.abs(dy) < 0.001
      ? Infinity
      : ((dy > 0 ? seat.y + seat.height + padding : seat.y - padding) -
          target.y) /
        dy;
  const distance = Math.min(x, y, 1);
  return {
    x: target.x + dx * distance,
    y: target.y + dy * distance,
  };
}

function createRuntime(
  initialProps: GunTableProps,
  layer: HTMLDivElement,
  canvas: HTMLCanvasElement,
  svg: SVGSVGElement,
  markers: HTMLDivElement,
  maskId: string,
): Runtime {
  const table = initialProps.tableRef.current!;
  const scene = new Scene();
  const gunGroup = new Group();
  scene.add(gunGroup);
  const camera = new OrthographicCamera(0, 1, 0, -1, 0.1, 2000);
  camera.position.z = 1000;
  const sky = new HemisphereLight(0xe5efff, 0x354053, 3);
  const key = new DirectionalLight(0xffffff, 3);
  key.position.set(-200, 300, 700);
  const rim = new DirectionalLight(0x9acaff, 2);
  rim.position.set(400, -300, 450);
  scene.add(sky, key, rim);

  let renderer: WebGLRenderer | null = null;
  let source: Object3D | null = null;
  let disposed = false;
  let failed = false;
  let props = initialProps;
  let stateKey = snapshotKey(props);
  let slots = reconcileGunSlots([], props.players, props.gunSupply);
  let frame = 0;
  let width = 0;
  let height = 0;
  let frameCount = 0;
  let layoutDirty = true;
  let snapNext = true;
  let inViewport = true;
  let modelHeight = 0.4;
  const visuals = new Map<string, GunVisual>();
  const observed = new Set<Element>();
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const ease = movementEasing(table);
  const currentDirection = new Vector3();
  const definitions = svgElement("defs");
  const mask = svgElement("mask", {
    id: maskId,
    maskUnits: "userSpaceOnUse",
    x: 0,
    y: 0,
  });
  const maskBackground = svgElement("rect", { fill: "white" });
  const exclusions = svgElement("g", { fill: "black" });
  mask.append(maskBackground, exclusions);
  definitions.append(mask);
  const lines = svgElement("g", { mask: `url(#${maskId})` });
  svg.append(definitions, lines);

  function cancelFrame() {
    if (frame) window.cancelAnimationFrame(frame);
    frame = 0;
  }

  function fail(reason: string) {
    if (disposed || failed) return;
    failed = true;
    cancelFrame();
    layer.dataset.status = "error";
    layer.dataset.error = reason;
    layer.dataset.motion = "idle";
  }

  function canRender() {
    return !disposed && !failed && !document.hidden && inViewport;
  }

  function requestRender() {
    if (!frame && source && canRender()) {
      frame = window.requestAnimationFrame(render);
    }
  }

  function requestLayout(snap = false) {
    layoutDirty = true;
    snapNext ||= snap;
    requestRender();
  }

  function applyTheme() {
    const dark = props.theme === "dark";
    layer.dataset.theme = props.theme;
    sky.color.setHex(dark ? 0xe3ecff : 0xffffff);
    sky.groundColor.setHex(dark ? 0x53637c : 0x8d98aa);
    sky.intensity = dark ? 3.6 : 2.7;
    key.intensity = dark ? 6 : 2.8;
    rim.color.setHex(dark ? 0xadcfff : 0xcadfff);
    rim.intensity = dark ? 4 : 1.6;
    if (renderer) renderer.toneMappingExposure = dark ? 1.65 : 1.05;
  }

  function currentPose(visual: GunVisual): Pose {
    return {
      position: visual.model.position.clone(),
      rotation: visual.model.quaternion.clone(),
      scale: visual.model.scale.x,
    };
  }

  function createVisual(slot: GunSlot, pose: Pose): GunVisual {
    const model = source!.clone(true);
    model.position.copy(pose.position);
    model.quaternion.copy(pose.rotation);
    model.scale.setScalar(pose.scale);
    gunGroup.add(model);
    const marker = document.createElement("span");
    marker.dataset.gunSlot = slot.id;
    markers.append(marker);
    const line = svgElement("line", { class: "gun-table-aim-line" });
    const dot = svgElement("circle", {
      class: "gun-table-aim-dot",
      r: 2.2,
    });
    lines.append(line, dot);
    return {
      slot,
      model,
      marker,
      line,
      dot,
      from: pose,
      to: pose,
      startedAt: 0,
      moving: false,
      endpoint: null,
    };
  }

  function measure(now: number) {
    layoutDirty = false;
    const bounds = layer.getBoundingClientRect();
    const nextWidth = layer.clientWidth;
    const nextHeight = layer.clientHeight;
    if (!nextWidth || !nextHeight) return;
    if (nextWidth !== width || nextHeight !== height) {
      width = nextWidth;
      height = nextHeight;
      renderer!.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
      renderer!.setSize(width, height, false);
      camera.right = width;
      camera.bottom = -height;
      camera.updateProjectionMatrix();
      svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
      mask.setAttribute("width", String(width));
      mask.setAttribute("height", String(height));
      maskBackground.setAttribute("width", String(width));
      maskBackground.setAttribute("height", String(height));
    }
    const localRect = (element: Element): Rect => {
      const rect = element.getBoundingClientRect();
      return {
        x: rect.left - bounds.left,
        y: rect.top - bounds.top,
        width: rect.width,
        height: rect.height,
      };
    };
    const center = (rect: Rect): Point => ({
      x: rect.x + rect.width / 2,
      y: rect.y + rect.height / 2,
    });
    const rackElement = table.querySelector<HTMLElement>("[data-gun-rack]");
    const rack = rackElement
      ? localRect(rackElement)
      : { x: width / 2 - 30, y: height / 2 - 60, width: 60, height: 120 };
    const rackCenter = center(rack);
    const seatElements = new Map<string, HTMLElement>();
    for (const element of table.querySelectorAll<HTMLElement>(
      ".player-seat[data-player-id]",
    )) {
      seatElements.set(element.dataset.playerId!, element);
    }
    const anchors = new Set<Element>([table]);
    if (rackElement) anchors.add(rackElement);
    exclusions.replaceChildren();
    for (const seat of seatElements.values()) {
      anchors.add(seat);
      const dock = seat.querySelector<HTMLElement>("[data-gun-dock]");
      const name = seat.querySelector<HTMLElement>(".player-name-row");
      if (dock) anchors.add(dock);
      if (name) anchors.add(name);
      const rect = localRect(seat);
      exclusions.append(
        svgElement("rect", {
          x: rect.x - 3,
          y: rect.y - 3,
          width: rect.width + 6,
          height: rect.height + 6,
          rx: 6,
        }),
      );
    }
    for (const label of table.querySelectorAll<HTMLElement>(
      ".gun-supply, .shot-countdown",
    )) {
      const rect = localRect(label);
      exclusions.append(svgElement("rect", { ...rect, rx: 4 }));
    }
    const publicSlots = slots.filter((slot) => !slot.ownerId);
    const publicCount = Math.max(1, publicSlots.length);
    const horizontalRack = rack.width > rack.height * 1.5;
    const rackGap = horizontalRack ? 16 : 0;
    const columnWidth =
      (rack.width - rackGap * (publicCount - 1)) / publicCount;
    const rowHeight = rack.height / publicCount;
    const rackScale = horizontalRack
      ? Math.min(columnWidth, (rack.height * 0.94) / modelHeight, 122)
      : Math.min(rack.width * 0.9, (rowHeight * 0.86) / modelHeight, 122);
    const present = new Set(slots.map((slot) => slot.id));
    for (const [id, visual] of visuals) {
      if (present.has(id)) continue;
      gunGroup.remove(visual.model);
      visual.marker.remove();
      visual.line.remove();
      visual.dot.remove();
      visuals.delete(id);
    }
    for (const slot of slots) {
      const owner = slot.ownerId ? seatElements.get(slot.ownerId) : null;
      const dock = owner?.querySelector<HTMLElement>("[data-gun-dock]");
      if (dock) anchors.add(dock);
      const dockRect = dock ? localRect(dock) : null;
      const row = Math.max(
        0,
        publicSlots.findIndex((item) => item.id === slot.id),
      );
      const position = dockRect
        ? center(dockRect)
        : {
            x: horizontalRack
              ? rack.x + columnWidth / 2 + (columnWidth + rackGap) * row
              : rackCenter.x,
            y: horizontalRack ? rackCenter.y : rack.y + rowHeight * (row + 0.5),
          };
      const target = slot.targetId ? seatElements.get(slot.targetId) : null;
      const targetName = target?.querySelector<HTMLElement>(".player-name-row");
      if (targetName) anchors.add(targetName);
      const targetCenter = target
        ? center(localRect(targetName || target))
        : rackCenter;
      const rotation = dockRect
        ? new Quaternion()
            .setFromAxisAngle(
              Z_AXIS,
              Math.atan2(
                -(targetCenter.y - position.y),
                targetCenter.x - position.x,
              ),
            )
            .multiply(TOP_VIEW)
        : new Quaternion();
      const pose: Pose = {
        position: new Vector3(position.x, -position.y, 0),
        rotation,
        scale: dockRect
          ? Math.min(82, dockRect.width * 0.86, dockRect.height * 0.93)
          : rackScale,
      };
      let visual = visuals.get(slot.id);
      if (!visual) {
        visual = createVisual(slot, pose);
        visuals.set(slot.id, visual);
      }
      visual.slot = slot;
      visual.endpoint = target
        ? outsideSeat(targetCenter, position, localRect(target))
        : null;
      visual.marker.dataset.ownerId = slot.ownerId || "";
      visual.marker.dataset.targetId = slot.targetId || "";
      visual.marker.dataset.pose = dockRect ? "held" : "rack";
      visual.marker.dataset.toX = pose.position.x.toFixed(2);
      visual.marker.dataset.toY = (-pose.position.y).toFixed(2);
      visual.marker.dataset.toQuaternion = pose.rotation.toArray().join(",");
      const changed =
        visual.to.position.distanceToSquared(pose.position) > 0.01 ||
        1 - Math.abs(visual.to.rotation.dot(pose.rotation)) > 0.00001 ||
        Math.abs(visual.to.scale - pose.scale) > 0.01;
      if (snapNext || reduceMotion.matches) {
        visual.to = pose;
        visual.model.position.copy(pose.position);
        visual.model.quaternion.copy(pose.rotation);
        visual.model.scale.setScalar(pose.scale);
        visual.from = currentPose(visual);
        visual.moving = false;
      } else if (changed) {
        // Interrupted changes continue from the visible pose, never the old start.
        visual.from = currentPose(visual);
        visual.to = pose;
        visual.startedAt = now;
        visual.moving = true;
      }
    }
    for (const element of observed) {
      if (!anchors.has(element)) {
        resizeObserver.unobserve(element);
        observed.delete(element);
      }
    }
    for (const element of anchors) {
      if (!observed.has(element)) {
        resizeObserver.observe(element);
        observed.add(element);
      }
    }
    layer.dataset.gunCount = String(slots.length);
    layer.dataset.gunSupply = String(props.gunSupply);
    snapNext = false;
  }

  function render(now: number) {
    frame = 0;
    if (!canRender() || !renderer || !source) return;
    try {
      if (layoutDirty) measure(now);
      if (!width || !height) return;
      let moving = false;
      for (const visual of visuals.values()) {
        if (visual.moving) {
          const progress = Math.min(1, (now - visual.startedAt) / MOVE_MS);
          const amount = ease(progress);
          visual.model.position.lerpVectors(
            visual.from.position,
            visual.to.position,
            amount,
          );
          visual.model.quaternion.slerpQuaternions(
            visual.from.rotation,
            visual.to.rotation,
            amount,
          );
          visual.model.scale.setScalar(
            visual.from.scale + (visual.to.scale - visual.from.scale) * amount,
          );
          visual.moving = progress < 1;
        }
        moving ||= visual.moving;
        const { model, marker } = visual;
        marker.dataset.motion = visual.moving ? "moving" : "idle";
        marker.dataset.x = model.position.x.toFixed(2);
        marker.dataset.y = (-model.position.y).toFixed(2);
        marker.dataset.quaternion = model.quaternion
          .toArray()
          .map((value) => value.toFixed(5))
          .join(",");
        marker.dataset.scale = model.scale.x.toFixed(2);
        const hasLine = !!visual.slot.ownerId && !!visual.endpoint;
        visual.line.style.display = hasLine ? "" : "none";
        visual.dot.style.display = hasLine ? "" : "none";
        if (hasLine) {
          currentDirection.set(1, 0, 0).applyQuaternion(model.quaternion);
          visual.line.setAttribute(
            "x1",
            String(model.position.x + currentDirection.x * model.scale.x * 0.5),
          );
          visual.line.setAttribute(
            "y1",
            String(
              -model.position.y - currentDirection.y * model.scale.x * 0.5,
            ),
          );
          visual.line.setAttribute("x2", String(visual.endpoint!.x));
          visual.line.setAttribute("y2", String(visual.endpoint!.y));
          visual.dot.setAttribute("cx", String(visual.endpoint!.x));
          visual.dot.setAttribute("cy", String(visual.endpoint!.y));
        }
      }
      renderer.render(scene, camera);
      frameCount += 1;
      layer.dataset.frameCount = String(frameCount);
      layer.dataset.status = "ready";
      layer.dataset.motion = moving ? "moving" : "idle";
      if (moving) requestRender();
    } catch {
      fail("render-failed");
    }
  }

  // Initial notifications for newly observed anchors must not finish an
  // in-flight pickup. Unchanged poses retain their original interpolation.
  const resizeObserver = new ResizeObserver(() => requestLayout());
  resizeObserver.observe(table);
  observed.add(table);
  const mutationObserver = new MutationObserver((records) => {
    if (records.some((record) => !layer.contains(record.target))) {
      requestLayout();
    }
  });
  mutationObserver.observe(table, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["class", "data-player-id"],
  });
  const intersectionObserver = new IntersectionObserver(([entry]) => {
    inViewport = !!entry?.isIntersecting;
    layer.dataset.paused = String(!inViewport || document.hidden);
    if (inViewport) requestLayout(true);
    else {
      cancelFrame();
      snapNext = true;
      layer.dataset.motion = "idle";
    }
  });
  intersectionObserver.observe(table);
  const onVisibility = () => {
    layer.dataset.paused = String(document.hidden || !inViewport);
    if (document.hidden) {
      cancelFrame();
      snapNext = true;
      layer.dataset.motion = "idle";
    } else requestLayout(true);
  };
  const onResize = () => requestLayout(true);
  const onReduceMotion = () => requestLayout(reduceMotion.matches);
  const onContextLost = (event: Event) => {
    event.preventDefault();
    fail("context-lost");
  };
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("resize", onResize);
  reduceMotion.addEventListener("change", onReduceMotion);
  canvas.addEventListener("webglcontextlost", onContextLost);
  document.fonts.addEventListener("loadingdone", onResize);
  void document.fonts.ready.then(() => {
    if (!disposed) requestLayout(true);
  });

  try {
    renderer = new WebGLRenderer({
      canvas,
      alpha: true,
      antialias: true,
      powerPreference: "low-power",
    });
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = SRGBColorSpace;
    renderer.toneMapping = ACESFilmicToneMapping;
    applyTheme();
    new GLTFLoader().load(
      "/models/desert-eagle.glb",
      (gltf) => {
        if (disposed || failed) {
          disposeAsset(gltf.scene);
          return;
        }
        source = gltf.scene;
        const size = new Box3().setFromObject(source).getSize(new Vector3());
        modelHeight = Math.max(0.2, size.y / Math.max(size.x, 0.01));
        requestLayout(true);
      },
      undefined,
      () => fail("model-load-failed"),
    );
  } catch {
    fail("webgl-unavailable");
  }

  return {
    update(nextProps) {
      if (disposed || failed) return;
      const nextKey = snapshotKey(nextProps);
      const restored = nextProps.syncKey !== props.syncKey;
      const themeChanged = nextProps.theme !== props.theme;
      props = nextProps;
      if (nextKey !== stateKey) {
        slots = reconcileGunSlots(
          restored ? [] : slots,
          props.players,
          props.gunSupply,
        );
        stateKey = nextKey;
        requestLayout(restored);
      }
      if (themeChanged) {
        applyTheme();
        requestRender();
      }
    },
    dispose() {
      disposed = true;
      cancelFrame();
      resizeObserver.disconnect();
      mutationObserver.disconnect();
      intersectionObserver.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("resize", onResize);
      reduceMotion.removeEventListener("change", onReduceMotion);
      canvas.removeEventListener("webglcontextlost", onContextLost);
      document.fonts.removeEventListener("loadingdone", onResize);
      if (source) disposeAsset(source);
      visuals.clear();
      gunGroup.clear();
      renderer?.dispose();
      // StrictMode can immediately reuse this canvas. Forced context loss would
      // asynchronously invalidate that next renderer; dispose releases ours.
      svg.replaceChildren();
      markers.replaceChildren();
    },
  };
}

export default function GunTable(props: GunTableProps) {
  const layerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const markersRef = useRef<HTMLDivElement>(null);
  const runtimeRef = useRef<Runtime | null>(null);
  const latestProps = useRef(props);
  latestProps.current = props;
  const maskId = `gun-table-mask-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;

  useEffect(() => {
    if (
      !props.tableRef.current ||
      !layerRef.current ||
      !canvasRef.current ||
      !svgRef.current ||
      !markersRef.current
    )
      return;
    layerRef.current.dataset.status = "loading";
    delete layerRef.current.dataset.error;
    const runtime = createRuntime(
      latestProps.current,
      layerRef.current,
      canvasRef.current,
      svgRef.current,
      markersRef.current,
      maskId,
    );
    runtimeRef.current = runtime;
    return () => {
      runtime.dispose();
      runtimeRef.current = null;
    };
  }, [props.tableRef, maskId]);

  useEffect(() => {
    runtimeRef.current?.update(props);
  }, [props.players, props.gunSupply, props.syncKey, props.theme]);

  return (
    <div
      ref={layerRef}
      className="gun-table-layer"
      aria-hidden="true"
      data-status="loading"
      data-motion="idle"
    >
      <svg ref={svgRef} className="gun-table-directions" focusable="false" />
      <canvas ref={canvasRef} className="gun-table-canvas" />
      <div ref={markersRef} className="gun-table-model-state" hidden />
    </div>
  );
}
