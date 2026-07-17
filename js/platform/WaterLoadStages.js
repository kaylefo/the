/** Water lab load stages — kept free of Three.js / physics imports for deferred boot. */
export const WATER_LOAD_STAGES = [
  { id: "webgl_probe", label: "Checking WebGL support", weight: 8 },
  { id: "engine_module", label: "Downloading water physics engine", weight: 14 },
  { id: "device_profile", label: "Detecting device & quality tier", weight: 7 },
  { id: "scene_3d", label: "Creating 3D scene & tank", weight: 10 },
  { id: "webgl_renderer", label: "Initializing WebGL renderer", weight: 10 },
  { id: "studio_env", label: "Loading HDR studio environment", weight: 8 },
  { id: "water_renderer", label: "Compiling water & smoke shaders", weight: 12 },
  { id: "lights_input", label: "Setting up lights & controls", weight: 8 },
  { id: "fluid_grid", label: "Allocating FLIP water grid", weight: 15 },
  { id: "smoke_grid", label: "Allocating volumetric smoke grid", weight: 12 },
  { id: "fill_water", label: "Filling tank with water", weight: 10 },
  { id: "surface_mesh", label: "Extracting water surface mesh", weight: 8 },
  { id: "finalize", label: "Finalizing simulation", weight: 5 },
];
