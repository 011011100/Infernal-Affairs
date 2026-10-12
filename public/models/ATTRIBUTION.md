# Desert Eagle model attribution

- **Original work:** Low-Poly Desert Eagle
- **Creator:** [TastyTony](https://sketchfab.com/TastyTony)
- **Source:** [Low-Poly Desert Eagle on Sketchfab](https://sketchfab.com/3d-models/low-poly-desert-eagle-b81da261345f4462b2c4412352162287)
- **License:** [Creative Commons Attribution 4.0 International (CC BY 4.0)](https://creativecommons.org/licenses/by/4.0/)
- **Adapted file:** `desert-eagle.glb`

The original asset's attribution is also embedded in the adapted GLB. TastyTony
does not endorse this game or these modifications.

## Modifications

The project converted the supplied GLB for static rendering in Three.js:

- Converted `KHR_materials_pbrSpecularGlossiness` materials to standard glTF
  metallic-roughness materials: original linear diffuse colors become base
  colors, metallic is zero, and roughness is `1 - glossiness`. This is a material
  approximation; it preserves the original black, gray, and red palette.
- Baked the original static rest pose and mesh world transforms into vertices;
  transformed normals with the inverse-transpose of the corresponding combined
  skinning and world matrix. Removed the skeleton and non-mesh scene objects.
- Removed unused texture coordinates and joint attributes. The source has no
  textures or animation clips. Kept the original triangle topology, hard-edge
  normals, and material assignments.
- Centered the model's bounding box and uniformly scaled its overall length to
  one unit. The muzzle points along **+X**, the top along **+Y**, and the broad
  side faces **+Z**.

The adapted model contains **4,299 triangles**, **11 materials**, and 11 static
meshes. Its dimensions are approximately **1 × 0.558279 × 0.149289** units
(length × height × width). No animation clips are included.

## Reproduce

After installing the project's dependencies, run from the repository root:

```sh
node scripts/prepare-gun-model.mjs "/path/to/low-poly_desert_eagle.glb"
```

An optional second argument sets a different output path. The source file is
never modified. The converter checks that triangle count, material colors,
normal lengths, centering, and normalized size survive export and reload. It
prints the resulting dimensions, counts, byte size, and source SHA-256.
