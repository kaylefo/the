import { Mat3 } from "./Mat3.js";

/**
 * Neo-Hookean hyperelastic constitutive model (St. Venant–Kirchhoff variant via PK1).
 * ψ = μ/2 (I₁ - 3) - μ ln J + λ/2 (ln J)²
 * P = μ(F - F⁻ᵀ) + λ ln(J) F⁻ᵀ
 */
export const MATERIALS = {
  MESOCARP: 0,
  EXOCARP: 1,
  PLACENTA: 2,
  SEED: 3,
  LOCULE_FLUID: 4,
};

export const MATERIAL_PARAMS = {
  [MATERIALS.MESOCARP]: {
    density: 980,
    mu: 8e3,
    lambda: 4e4,
    fractureEnergy: 80,
    psiCrit: 2e4,
    damageRate: 0.8,
    color: [0.92, 0.28, 0.18],
  },
  [MATERIALS.EXOCARP]: {
    density: 1050,
    mu: 1.2e5,
    lambda: 6e5,
    fractureEnergy: 350,
    psiCrit: 8e4,
    damageRate: 0.35,
    color: [0.75, 0.12, 0.08],
  },
  [MATERIALS.PLACENTA]: {
    density: 1020,
    mu: 1.5e4,
    lambda: 8e4,
    fractureEnergy: 120,
    psiCrit: 3e4,
    damageRate: 0.6,
    color: [0.98, 0.45, 0.25],
  },
  [MATERIALS.SEED]: {
    density: 1100,
    mu: 5e5,
    lambda: 2e6,
    fractureEnergy: 1e6,
    psiCrit: 1e6,
    damageRate: 0,
    color: [0.92, 0.88, 0.72],
  },
  [MATERIALS.LOCULE_FLUID]: {
    density: 1040,
    mu: 50,
    lambda: 500,
    fractureEnergy: 0,
    psiCrit: 100,
    damageRate: 5,
    color: [0.95, 0.15, 0.05],
  },
};

const _Finv = new Mat3();
const _P = new Mat3();
const _Ft = new Mat3();
const _Cauchy = new Mat3();

export function computeStress(F, materialType, damage, volume, outStress = _Cauchy) {
  const params = MATERIAL_PARAMS[materialType];
  const mu = params.mu;
  const lambda = params.lambda;
  const degrade = (1 - damage) ** 2 + 1e-4;

  Mat3.invert(F, _Finv);
  const J = Mat3.det(F);
  const safeJ = Math.max(J, 0.1);
  const lnJ = Math.log(safeJ);

  Mat3.transpose(_Finv, _Ft);
  _P.set(
    degrade * mu * (F.m[0] - _Ft.m[0]) + degrade * lambda * lnJ * _Finv.m[0],
    degrade * mu * (F.m[1] - _Ft.m[1]) + degrade * lambda * lnJ * _Finv.m[1],
    degrade * mu * (F.m[2] - _Ft.m[2]) + degrade * lambda * lnJ * _Finv.m[2],
    degrade * mu * (F.m[3] - _Ft.m[3]) + degrade * lambda * lnJ * _Finv.m[3],
    degrade * mu * (F.m[4] - _Ft.m[4]) + degrade * lambda * lnJ * _Finv.m[4],
    degrade * mu * (F.m[5] - _Ft.m[5]) + degrade * lambda * lnJ * _Finv.m[5],
    degrade * mu * (F.m[6] - _Ft.m[6]) + degrade * lambda * lnJ * _Finv.m[6],
    degrade * mu * (F.m[7] - _Ft.m[7]) + degrade * lambda * lnJ * _Finv.m[7],
    degrade * mu * (F.m[8] - _Ft.m[8]) + degrade * lambda * lnJ * _Finv.m[8]
  );

  Mat3.mul(_P, _Ft, outStress);
  const invJ = 1 / safeJ;
  for (let i = 0; i < 9; i++) outStress.m[i] *= invJ;

  const I1 = F.m[0] ** 2 + F.m[1] ** 2 + F.m[2] ** 2 +
    F.m[3] ** 2 + F.m[4] ** 2 + F.m[5] ** 2 +
    F.m[6] ** 2 + F.m[7] ** 2 + F.m[8] ** 2;
  const psi = 0.5 * mu * (I1 - 3) - mu * lnJ + 0.5 * lambda * lnJ * lnJ;

  return { stress: outStress, psi, J: safeJ };
}

export function stressForceContribution(stress, volume, dweight, cellDist, out) {
  // APIC stress: -volume * stress * grad(weight) ≈ -volume * stress * dweight * cellDist / dx
  const s = stress.m;
  const d = cellDist;
  out[0] -= volume * (s[0] * d[0] + s[3] * d[1] + s[6] * d[2]) * dweight;
  out[1] -= volume * (s[1] * d[0] + s[4] * d[1] + s[7] * d[2]) * dweight;
  out[2] -= volume * (s[2] * d[0] + s[5] * d[1] + s[8] * d[2]) * dweight;
}
