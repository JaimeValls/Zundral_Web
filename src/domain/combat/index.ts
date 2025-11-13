import { config } from '../../config/gameConfig'

export interface CombatModifiers {
  tactics?: number // 0-100, affects outcome
  weather?: number // -20 to +20
  leaders?: number // 0-50 bonus
  supply?: number // 0-100, affects effectiveness
}

export interface CombatResult {
  victory: boolean
  duration: number // seconds
  losses: number // percentage
  forecast: string
}

/**
 * Generate random number in range
 */
function randomRange(min: number, max: number): number {
  return Math.random() * (max - min) + min
}

/**
 * Calculate base combat power
 */
function calcBasePower(attackerPower: number, defenderPower: number): number {
  return attackerPower / (attackerPower + defenderPower)
}

/**
 * Apply combat modifiers
 */
function applyModifiers(
  basePower: number,
  modifiers: CombatModifiers
): number {
  let modified = basePower

  // Tactics modifier (0-100, affects outcome)
  if (modifiers.tactics !== undefined) {
    const tacticsBonus = (modifiers.tactics - 50) / 100 // -0.5 to +0.5
    modified += tacticsBonus * 0.2
  }

  // Weather modifier (-20 to +20)
  if (modifiers.weather !== undefined) {
    modified += modifiers.weather / 100
  }

  // Leaders bonus (0-50)
  if (modifiers.leaders !== undefined) {
    modified += modifiers.leaders / 200
  }

  // Supply modifier (0-100, affects effectiveness)
  if (modifiers.supply !== undefined) {
    const supplyMultiplier = modifiers.supply / 100
    modified *= 0.5 + supplyMultiplier * 0.5 // 50% to 100% effectiveness
  }

  return Math.max(0, Math.min(1, modified))
}

/**
 * Calculate combat result
 */
export function calculateCombat(
  attackerPower: number,
  defenderPower: number,
  modifiers: CombatModifiers = {}
): CombatResult {
  // Base deterministic calculation
  const basePower = calcBasePower(attackerPower, defenderPower)

  // Apply modifiers
  const modifiedPower = applyModifiers(basePower, modifiers)

  // Apply RNG band
  const rng = randomRange(
    -config.combat.rngBand.max,
    config.combat.rngBand.max
  )
  const finalPower = Math.max(0, Math.min(1, modifiedPower + rng))

  // Determine victory
  const victory = finalPower > 0.5

  // Calculate duration (longer for closer matches)
  const powerDiff = Math.abs(attackerPower - defenderPower)
  const totalPower = attackerPower + defenderPower
  const difficulty = powerDiff / totalPower
  const baseDuration = 3600 // 1 hour base
  const duration = baseDuration * (1 + difficulty * 2) // 1-3 hours

  // Calculate losses (higher for closer matches, lower for decisive victories)
  const baseLosses = victory ? 5 : 15
  const lossVariation = difficulty * 10
  const losses = Math.max(1, Math.min(30, baseLosses + lossVariation + rng * 5))

  // Generate forecast
  const forecast = generateForecast(victory, duration, losses)

  return {
    victory,
    duration: Math.floor(duration),
    losses: Math.floor(losses),
    forecast,
  }
}

/**
 * Generate forecast string
 */
function generateForecast(
  victory: boolean,
  duration: number,
  losses: number
): string {
  const hours = Math.floor(duration / 3600)
  const minutes = Math.floor((duration % 3600) / 60)
  const timeStr =
    hours > 0
      ? `~${hours}-${hours + 1}h`
      : minutes > 0
      ? `~${minutes}-${minutes + 5}m`
      : '~1-5m'

  const lossRange = `${Math.max(1, Math.floor(losses * 0.8))}-${Math.min(30, Math.ceil(losses * 1.2))}%`

  if (victory) {
    return `Win in ${timeStr}, ${lossRange} losses.`
  } else {
    return `Likely defeat in ${timeStr}, ${lossRange} losses.`
  }
}

/**
 * Calculate combat forecast without executing combat
 */
export function forecastCombat(
  attackerPower: number,
  defenderPower: number,
  modifiers: CombatModifiers = {}
): string {
  // Use average RNG for forecast
  const basePower = calcBasePower(attackerPower, defenderPower)
  const modifiedPower = applyModifiers(basePower, modifiers)

  const powerDiff = Math.abs(attackerPower - defenderPower)
  const totalPower = attackerPower + defenderPower
  const difficulty = powerDiff / totalPower
  const baseDuration = 3600
  const duration = baseDuration * (1 + difficulty * 2)

  const victory = modifiedPower > 0.5
  const baseLosses = victory ? 5 : 15
  const lossVariation = difficulty * 10
  const avgLosses = baseLosses + lossVariation

  return generateForecast(victory, duration, avgLosses)
}
