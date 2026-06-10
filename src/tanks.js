// © 2026 [YOUR NAME HERE]. All rights reserved.
// Unauthorized copying, distribution, or use of this software is strictly prohibited.

/**
 * The four chassis of IRON VOLLEY. Stats feed both physics and AI;
 * the silhouettes are built procedurally in tank.js so each chassis
 * reads instantly at a distance.
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
];

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
