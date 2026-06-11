// © 2026 [YOUR NAME HERE]. All rights reserved.
// Unauthorized copying, distribution, or use of this software is strictly prohibited.

/**
 * The twelve chassis of IRON VOLLEY. Stats feed both physics and AI;
 * the silhouettes are built procedurally in tank.js so each chassis
 * reads instantly at a distance. SKINS are paint finishes any chassis
 * can wear — solids and generated camo patterns.
 */

export const CHASSIS = [
  {
    id: "scout",
    name: "JACKAL",
    role: "Scout",
    blurb: "Fast and fragile. Win by never being where the shell lands.",
    stats: { speed: 34, accel: 26, turn: 1.9, hp: 80, reload: 2.6, shellSpeed: 120, shellDamage: 30, mgDamage: 3.4, turretTurn: 2.6 },
    build: { hullW: 6.4, hullH: 2.0, hullL: 9.4, turretR: 2.0, barrelL: 6.4, barrelR: 0.34, wheels: 5, lowProfile: true },
  },
  {
    id: "viper",
    name: "VIPER",
    role: "Skirmisher",
    blurb: "The all-rounder. Bites quick, slithers away quicker.",
    stats: { speed: 27, accel: 18, turn: 1.45, hp: 110, reload: 3.0, shellSpeed: 130, shellDamage: 38, mgDamage: 4.2, turretTurn: 2.2 },
    build: { hullW: 7.2, hullH: 2.4, hullL: 10.4, turretR: 2.4, barrelL: 7.2, barrelR: 0.38, wheels: 6, angular: true },
  },
  {
    id: "bastion",
    name: "BASTION",
    role: "Heavy",
    blurb: "A rolling fortress. Slow, furious, very hard to delete.",
    stats: { speed: 19, accel: 10, turn: 1.0, hp: 175, reload: 3.8, shellSpeed: 125, shellDamage: 52, mgDamage: 4.8, turretTurn: 1.5 },
    build: { hullW: 8.8, hullH: 3.2, hullL: 12.0, turretR: 3.0, barrelL: 7.8, barrelR: 0.5, wheels: 7, plated: true },
  },
  {
    id: "howitzer",
    name: "LONGBOW",
    role: "Artillery",
    blurb: "Outranges everything. Loves the far side of a hill.",
    stats: { speed: 22, accel: 12, turn: 1.15, hp: 100, reload: 4.4, shellSpeed: 165, shellDamage: 60, mgDamage: 3.0, turretTurn: 1.7 },
    build: { hullW: 7.4, hullH: 2.5, hullL: 11.2, turretR: 2.3, barrelL: 10.6, barrelR: 0.42, wheels: 6, longGun: true },
  },
  {
    id: "wasp",
    name: "WASP",
    role: "Interceptor",
    blurb: "Barely armored, barely visible, already behind you.",
    stats: { speed: 39, accel: 32, turn: 2.2, hp: 60, reload: 2.2, shellSpeed: 115, shellDamage: 24, mgDamage: 3.8, turretTurn: 3.0 },
    build: { hullW: 5.4, hullH: 1.7, hullL: 8.0, turretR: 1.6, barrelL: 5.6, barrelR: 0.3, wheels: 4, lowProfile: true },
  },
  {
    id: "mirage",
    name: "MIRAGE",
    role: "Hover Skirmisher",
    blurb: "Rides a cushion of screaming fans. Terrain is a suggestion.",
    stats: { speed: 31, accel: 22, turn: 1.8, hp: 90, reload: 2.8, shellSpeed: 135, shellDamage: 34, mgDamage: 4.0, turretTurn: 2.5 },
    build: { hullW: 7.0, hullH: 2.0, hullL: 10.0, turretR: 2.1, barrelL: 6.8, barrelR: 0.36, wheels: 0, hover: true, angular: true },
  },
  {
    id: "goliath",
    name: "GOLIATH",
    role: "Superheavy",
    blurb: "Half tank, half bunker. Bring friends. They'll need caskets.",
    stats: { speed: 14, accel: 8, turn: 0.85, hp: 230, reload: 4.2, shellSpeed: 120, shellDamage: 58, mgDamage: 5.2, turretTurn: 1.2 },
    build: { hullW: 9.6, hullH: 3.6, hullL: 13.2, turretR: 3.3, barrelL: 8.4, barrelR: 0.55, wheels: 8, plated: true },
  },
  {
    id: "stiletto",
    name: "STILETTO",
    role: "Glass Cannon",
    blurb: "One perfect shot. Then run like you mean it.",
    stats: { speed: 26, accel: 17, turn: 1.4, hp: 70, reload: 4.0, shellSpeed: 180, shellDamage: 72, mgDamage: 2.8, turretTurn: 2.0 },
    build: { hullW: 6.6, hullH: 2.1, hullL: 10.8, turretR: 1.9, barrelL: 11.6, barrelR: 0.36, wheels: 5, longGun: true, lowProfile: true },
  },
  {
    id: "tempest",
    name: "TEMPEST",
    role: "Autoloader",
    blurb: "Why aim once when you can correct four times?",
    stats: { speed: 25, accel: 16, turn: 1.4, hp: 105, reload: 1.7, shellSpeed: 125, shellDamage: 22, mgDamage: 4.4, turretTurn: 2.3 },
    build: { hullW: 7.0, hullH: 2.3, hullL: 9.8, turretR: 2.2, barrelL: 6.6, barrelR: 0.34, wheels: 6, boxTurret: true },
  },
  {
    id: "warden",
    name: "WARDEN",
    role: "Battle Tank",
    blurb: "The standard other tanks are measured against. And found wanting.",
    stats: { speed: 22, accel: 14, turn: 1.2, hp: 150, reload: 3.4, shellSpeed: 135, shellDamage: 44, mgDamage: 4.6, turretTurn: 1.8 },
    build: { hullW: 8.0, hullH: 2.8, hullL: 11.4, turretR: 2.7, barrelL: 8.0, barrelR: 0.46, wheels: 7, boxTurret: true, plated: true },
  },
  {
    id: "cobra",
    name: "COBRA",
    role: "Raider",
    blurb: "Long fangs, light feet. Strikes the flank and is gone.",
    stats: { speed: 30, accel: 20, turn: 1.7, hp: 85, reload: 3.2, shellSpeed: 155, shellDamage: 40, mgDamage: 3.6, turretTurn: 2.4 },
    build: { hullW: 6.8, hullH: 2.2, hullL: 10.6, turretR: 2.0, barrelL: 9.4, barrelR: 0.36, wheels: 6, longGun: true, angular: true },
  },
  {
    id: "mammoth",
    name: "MAMMOTH",
    role: "Twin Siege",
    blurb: "Two barrels because subtlety died in the first war.",
    stats: { speed: 16, accel: 9, turn: 0.95, hp: 195, reload: 3.6, shellSpeed: 130, shellDamage: 48, mgDamage: 5.0, turretTurn: 1.35 },
    build: { hullW: 9.2, hullH: 3.3, hullL: 12.6, turretR: 3.1, barrelL: 8.6, barrelR: 0.44, wheels: 8, twin: true, plated: true },
  },
];

// ── paint shop ──────────────────────────────────────────────────
export const SKINS = [
  { id: "factory", name: "Factory", kind: "team", desc: "Your team's colors" },
  { id: "tan", name: "Desert Tan", kind: "solid", color: 0xb49b6a },
  { id: "olive", name: "Olive Drab", kind: "solid", color: 0x5a6638 },
  { id: "brown", name: "Trench Brown", kind: "solid", color: 0x6b4a32 },
  { id: "red", name: "Warpaint Red", kind: "solid", color: 0x9c2f2a },
  { id: "arctic", name: "Arctic White", kind: "solid", color: 0xcfd8de },
  { id: "gunmetal", name: "Gunmetal", kind: "solid", color: 0x4a525c },
  { id: "desertcamo", name: "Desert Camo", kind: "camo", colors: [0xb49b6a, 0x8a6f48, 0xd6c29a] },
  { id: "woodland", name: "Woodland Camo", kind: "camo", colors: [0x4a5d33, 0x2f3c22, 0x6b5a3a] },
  { id: "urban", name: "Urban Camo", kind: "camo", colors: [0x6e7a85, 0x3c444c, 0xaab4bd] },
  { id: "tiger", name: "Tiger Stripe", kind: "camo", colors: [0xc28b3a, 0x2a241c, 0x8a5f28], stripes: true },
];

export function skinById(id) {
  return SKINS.find((s) => s.id === id) ?? SKINS[0];
}

export const TEAM_COLORS = [
  { id: "amber", body: 0xb98a3c, accent: 0xffd27a, name: "Amber" },
  { id: "cobalt", body: 0x3c6db9, accent: 0x7ab8ff, name: "Cobalt" },
  { id: "crimson", body: 0xb93c44, accent: 0xff7a84, name: "Crimson" },
  { id: "jade", body: 0x3cb96e, accent: 0x7affb6, name: "Jade" },
  { id: "violet", body: 0x7a3cb9, accent: 0xc77aff, name: "Violet" },
  { id: "slate", body: 0x5a6b7c, accent: 0xaebdca, name: "Slate" },
];

export function chassisById(id) {
  return CHASSIS.find((c) => c.id === id) ?? CHASSIS[1];
}
