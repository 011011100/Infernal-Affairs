import { useEffect, useRef, type RefObject } from "react";
import {
  ACESFilmicToneMapping,
  Box3,
  CanvasTexture,
  DirectionalLight,
  Group,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  OrthographicCamera,
  PlaneGeometry,
  PMREMGenerator,
  Quaternion,
  Scene,
  SRGBColorSpace,
  Texture,
  Vector3,
  WebGLRenderer,
  type BufferGeometry,
  type Material,
  type Object3D,
  type WebGLRenderTarget,
} from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
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
  shadow: Mesh<PlaneGeometry, MeshBasicMaterial>;
  marker: HTMLSpanElement;
  from: Pose;
  to: Pose;
  startedAt: number;
  moving: boolean;
};
type Runtime = { update: (props: GunTableProps) => void; dispose: () => void };

const MOVE_MS = 500;
const Z_AXIS = new Vector3(0, 0, 1);
const TOP_VIEW = new Quaternion().setFromAxisAngle(
  new Vector3(1, 0, 0),
  (68 * Math.PI) / 180,
);
const SIDE_VIEW = new Quaternion().setFromAxisAngle(
  new Vector3(0, 1, 0),
  (-12 * Math.PI) / 180,
);
// Measured from this normalized GLB's muzzle. Tilting the model makes the
// barrel's height visible, so aim its axis rather than the bounding-box center.
const BARREL_OFFSET = new Vector3(0, 0.21669, -0.000096).applyQuaternion(
  TOP_VIEW,
).y;

function stackLayout(
  count: number,
  narrow: boolean,
  height: number,
  depth: number,
) {
  const bounds = new Box3();
  const poses = Array.from({ length: count }, (_, index) => {
    const offset = index - (count - 1) / 2;
    const rotation = new Quaternion()
      .setFromAxisAngle(
        Z_AXIS,
        (narrow ? Math.PI / 2 : 0) + (offset * Math.PI) / 9,
      )
      .multiply(SIDE_VIEW);
    const position = new Vector3(offset * 0.1, offset * 0.11, offset * 0.4);
    for (const x of [-0.5, 0.5]) {
      for (const y of [-height / 2, height / 2]) {
        for (const z of [-depth / 2, depth / 2]) {
          bounds.expandByPoint(
            new Vector3(x, y, z).applyQuaternion(rotation).add(position),
          );
        }
      }
    }
    return { position, rotation };
  });
  const middle = bounds.getCenter(new Vector3());
  for (const pose of poses) pose.position.sub(middle);
  return { poses, size: bounds.getSize(new Vector3()) };
}

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

function disposeAsset(
  root: Object3D | null,
  extraGeometries: readonly BufferGeometry[] = [],
  extraMaterials: readonly Material[] = [],
) {
  const geometries = new Set<BufferGeometry>(extraGeometries);
  const materials = new Set<Material>(extraMaterials);
  const textures = new Set<Texture>();
  root?.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    geometries.add(object.geometry);
    const list = Array.isArray(object.material)
      ? object.material
      : [object.material];
    for (const material of list) {
      materials.add(material);
    }
  });
  for (const material of materials) {
    for (const value of Object.values(material)) {
      if (value instanceof Texture) textures.add(value);
    }
  }
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

function tuneGunMaterials(root: Object3D) {
  // The normalized asset's upper slide meshes are .004/.005/.010; its
  // rear/lower grip meshes are material_0/.006. Mixed frame .003 stays satin.
  // Preserve every original color and keep the red sight (.009) nonmetallic.
  const finishes: Record<string, readonly [number, number]> = {
    "Material.004": [0.5, 0.4],
    "Material.005": [0.5, 0.4],
    "Material.010": [0.5, 0.42],
    "Material.003": [0.32, 0.52],
    "Material.008": [0.4, 0.46],
    Material: [0.48, 0.42],
    "Material.001": [0.48, 0.42],
    "Material.002": [0.48, 0.42],
    material_0: [0.04, 0.84],
    "Material.006": [0.08, 0.8],
    "Material.009": [0, 0.78],
  };
  const visited = new Set<Material>();
  root.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    const materials = Array.isArray(object.material)
      ? object.material
      : [object.material];
    for (const material of materials) {
      if (!(material instanceof MeshStandardMaterial) || visited.has(material))
        continue;
      visited.add(material);
      const finish = finishes[material.name];
      if (!finish) continue;
      [material.metalness, material.roughness] = finish;
    }
  });
}

function createShadowMaterial() {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const context = canvas.getContext("2d");
  if (context) {
    const gradient = context.createRadialGradient(64, 64, 0, 64, 64, 62);
    gradient.addColorStop(0, "rgba(0, 0, 0, 0.55)");
    gradient.addColorStop(0.25, "rgba(0, 0, 0, 0.35)");
    gradient.addColorStop(0.65, "rgba(0, 0, 0, 0.1)");
    gradient.addColorStop(1, "rgba(0, 0, 0, 0)");
    context.fillStyle = gradient;
    context.fillRect(0, 0, 128, 128);
  }
  return new MeshBasicMaterial({
    map: new CanvasTexture(canvas),
    color: 0x000000,
    transparent: true,
    depthWrite: false,
    toneMapped: false,
  });
}

function createRuntime(
  initialProps: GunTableProps,
  layer: HTMLDivElement,
  canvas: HTMLCanvasElement,
  markers: HTMLDivElement,
): Runtime {
  const table = initialProps.tableRef.current!;
  const scene = new Scene();
  const gunGroup = new Group();
  scene.add(gunGroup);
  const camera = new OrthographicCamera(0, 1, 0, -1, 0.1, 2000);
  camera.position.z = 1000;
  const sky = new HemisphereLight(0xe5efff, 0x354053, 0.5);
  const key = new DirectionalLight(0xffffff, 3);
  key.position.set(-350, 400, 380);
  const rim = new DirectionalLight(0xc4daed, 0.8);
  rim.position.set(320, -170, 260);
  scene.add(sky, key, rim);
  const shadowGeometry = new PlaneGeometry(1, 1);
  const shadowMaterial = createShadowMaterial();

  let renderer: WebGLRenderer | null = null;
  let environment: WebGLRenderTarget | null = null;
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
  let modelDepth = 0.15;
  const visuals = new Map<string, GunVisual>();
  const observed = new Set<Element>();
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const ease = movementEasing(table);
  const currentDirection = new Vector3();
  const currentUp = new Vector3();
  const currentSide = new Vector3();

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
    sky.intensity = dark ? 0.5 : 0.35;
    key.intensity = dark ? 2.7 : 2.8;
    rim.color.setHex(dark ? 0xc4daed : 0xe1e9f0);
    rim.intensity = dark ? 1 : 0.75;
    scene.environmentIntensity = dark ? 0.65 : 0.7;
    shadowMaterial.opacity = dark ? 0.55 : 0.48;
    if (renderer) renderer.toneMappingExposure = 1.05;
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
    const shadow = new Mesh(shadowGeometry, shadowMaterial);
    // A shared soft footprint adds grounding without another render pass.
    shadow.renderOrder = -1;
    gunGroup.add(shadow);
    const marker = document.createElement("span");
    marker.dataset.gunSlot = slot.id;
    markers.append(marker);
    return {
      slot,
      model,
      shadow,
      marker,
      from: pose,
      to: pose,
      startedAt: 0,
      moving: false,
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
    for (const seat of seatElements.values()) {
      anchors.add(seat);
      const dock = seat.querySelector<HTMLElement>("[data-gun-dock]");
      const name = seat.querySelector<HTMLElement>(".player-name-row");
      if (dock) anchors.add(dock);
      if (name) anchors.add(name);
    }
    const publicSlots = slots.filter((slot) => !slot.ownerId);
    const publicCount = Math.max(1, publicSlots.length);
    const narrowRack = rack.width < rack.height;
    const stack = stackLayout(publicCount, narrowRack, modelHeight, modelDepth);
    // Fit the whole pile, and keep its model size stable as guns are taken.
    const fullStack = stackLayout(
      Math.max(1, slots.length),
      narrowRack,
      modelHeight,
      modelDepth,
    );
    const rackScale = Math.min(
      148,
      (rack.width * 0.94) / fullStack.size.x,
      (rack.height * 0.94) / fullStack.size.y,
    );
    const heldScale = window.matchMedia("(max-width: 640px)").matches ? 78 : 96;
    const present = new Set(slots.map((slot) => slot.id));
    for (const [id, visual] of visuals) {
      if (present.has(id)) continue;
      gunGroup.remove(visual.model);
      gunGroup.remove(visual.shadow);
      visual.marker.remove();
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
      // The reconciler claims the first free slot, so keep it on top of the pile.
      const stacked = stack.poses[publicCount - 1 - row]!;
      const position = dockRect
        ? center(dockRect)
        : {
            x: rackCenter.x + stacked.position.x * rackScale,
            y: rackCenter.y - stacked.position.y * rackScale,
          };
      // A middle seat's held gun sits beside the pile instead of covering it.
      if (dockRect && publicSlots.length && !narrowRack) {
        const clearanceX = (stack.size.x * rackScale) / 2 + heldScale / 2 + 12;
        const clearanceY = (stack.size.y * rackScale) / 2 + heldScale / 2 + 8;
        if (
          Math.abs(position.x - rackCenter.x) < clearanceX &&
          Math.abs(position.y - rackCenter.y) < clearanceY
        ) {
          const direction = position.x < rackCenter.x ? -1 : 1;
          position.x = rackCenter.x + direction * clearanceX;
        }
      }
      const target = slot.targetId ? seatElements.get(slot.targetId) : null;
      const targetName = target?.querySelector<HTMLElement>(".player-name-row");
      if (targetName) anchors.add(targetName);
      const targetCenter = target
        ? center(localRect(targetName || target))
        : rackCenter;
      const scale = dockRect
        ? Math.min(heldScale, dockRect.width * 0.92)
        : rackScale;
      const deltaX = targetCenter.x - position.x;
      const deltaY = -(targetCenter.y - position.y);
      const barrelCorrection = Math.asin(
        Math.min(
          1,
          (BARREL_OFFSET * scale) / Math.max(1, Math.hypot(deltaX, deltaY)),
        ),
      );
      const rotation = dockRect
        ? new Quaternion()
            .setFromAxisAngle(
              Z_AXIS,
              Math.atan2(deltaY, deltaX) - barrelCorrection,
            )
            .multiply(TOP_VIEW)
        : stacked.rotation;
      const pose: Pose = {
        position: new Vector3(
          position.x,
          -position.y,
          dockRect ? 220 : stacked.position.z * rackScale,
        ),
        rotation,
        scale,
      };
      let visual = visuals.get(slot.id);
      if (!visual) {
        visual = createVisual(slot, pose);
        visuals.set(slot.id, visual);
      }
      visual.slot = slot;
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
        currentDirection.set(1, 0, 0).applyQuaternion(model.quaternion);
        currentUp.set(0, 1, 0).applyQuaternion(model.quaternion);
        currentSide.set(0, 0, 1).applyQuaternion(model.quaternion);
        const heading = Math.atan2(currentDirection.y, currentDirection.x);
        const crossX = -Math.sin(heading);
        const crossY = Math.cos(heading);
        const footprintWidth =
          Math.abs(currentUp.x * crossX + currentUp.y * crossY) * modelHeight +
          Math.abs(currentSide.x * crossX + currentSide.y * crossY) *
            modelDepth;
        visual.shadow.position.set(
          model.position.x + 2,
          model.position.y - 3,
          -200,
        );
        visual.shadow.rotation.z = heading;
        visual.shadow.scale.set(
          model.scale.x * 1.05,
          model.scale.x * Math.max(0.16, footprintWidth) * 1.15,
          1,
        );
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
    const room = new RoomEnvironment();
    const generator = new PMREMGenerator(renderer);
    const renderState = {
      target: renderer.getRenderTarget(),
      cubeFace: renderer.getActiveCubeFace(),
      mipLevel: renderer.getActiveMipmapLevel(),
      autoClear: renderer.autoClear,
      toneMapping: renderer.toneMapping,
      xrEnabled: renderer.xr.enabled,
    };
    let failedTarget: WebGLRenderTarget | null = null;
    try {
      environment = generator.fromScene(room, 0.02, 0.1, 100, { size: 128 });
      scene.environment = environment.texture;
      layer.dataset.environment = "studio";
    } catch {
      // Direct lighting remains usable when an environment target cannot allocate.
      failedTarget = renderer.getRenderTarget();
      layer.dataset.environment = "direct-light";
    } finally {
      // PMREM restores these only on success. A failed offscreen pass must not
      // leave subsequent game frames bound to its framebuffer or disable clear.
      renderer.setRenderTarget(
        renderState.target,
        renderState.cubeFace,
        renderState.mipLevel,
      );
      renderer.autoClear = renderState.autoClear;
      renderer.toneMapping = renderState.toneMapping;
      renderer.xr.enabled = renderState.xrEnabled;
      if (failedTarget && failedTarget !== renderState.target)
        failedTarget.dispose();
      room.dispose();
      generator.dispose();
    }
    applyTheme();
    new GLTFLoader().load(
      "/models/desert-eagle.glb",
      (gltf) => {
        if (disposed || failed) {
          disposeAsset(gltf.scene);
          return;
        }
        source = gltf.scene;
        tuneGunMaterials(source);
        const size = new Box3().setFromObject(source).getSize(new Vector3());
        modelHeight = Math.max(0.2, size.y / Math.max(size.x, 0.01));
        modelDepth = Math.max(0.05, size.z / Math.max(size.x, 0.01));
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
      disposeAsset(source, [shadowGeometry], [shadowMaterial]);
      scene.environment = null;
      environment?.dispose();
      visuals.clear();
      gunGroup.clear();
      renderer?.dispose();
      // StrictMode can immediately reuse this canvas. Forced context loss would
      // asynchronously invalidate that next renderer; dispose releases ours.
      markers.replaceChildren();
    },
  };
}

export default function GunTable(props: GunTableProps) {
  const layerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const markersRef = useRef<HTMLDivElement>(null);
  const runtimeRef = useRef<Runtime | null>(null);
  const latestProps = useRef(props);
  latestProps.current = props;

  useEffect(() => {
    if (
      !props.tableRef.current ||
      !layerRef.current ||
      !canvasRef.current ||
      !markersRef.current
    )
      return;
    layerRef.current.dataset.status = "loading";
    delete layerRef.current.dataset.error;
    const runtime = createRuntime(
      latestProps.current,
      layerRef.current,
      canvasRef.current,
      markersRef.current,
    );
    runtimeRef.current = runtime;
    return () => {
      runtime.dispose();
      runtimeRef.current = null;
    };
  }, [props.tableRef]);

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
      <canvas ref={canvasRef} className="gun-table-canvas" />
      <div ref={markersRef} className="gun-table-model-state" hidden />
    </div>
  );
}
