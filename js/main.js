import { TomatoSimulation } from "./TomatoSimulation.js";

const canvas = document.getElementById("canvas");
const sim = new TomatoSimulation(canvas);
sim.start();
