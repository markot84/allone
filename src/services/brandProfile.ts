import { FirestoreService } from './firestore';
import type { BrandArchetype, BrandICP, BrandProfile } from '../types';

export const BRAND_ARCHETYPES: Array<{ id: BrandArchetype; label: string; toneHint: string; description: string }> = [
  {
    id: 'ruler',
    label: 'Ruler',
    toneHint: 'authoritative, premium, precise, confident, curated',
    description: 'Leadership, control, status, standards, exclusivity.',
  },
  {
    id: 'hero',
    label: 'Hero',
    toneHint: 'bold, motivating, performance-driven, energetic',
    description: 'Achievement, effort, discipline, winning, progress.',
  },
  {
    id: 'sage',
    label: 'Sage',
    toneHint: 'expert, analytical, educational, calm, evidence-led',
    description: 'Expertise, clarity, knowledge, trusted guidance.',
  },
  {
    id: 'explorer',
    label: 'Explorer',
    toneHint: 'free, adventurous, discovery-led, optimistic',
    description: 'Freedom, discovery, new experiences, independence.',
  },
  {
    id: 'creator',
    label: 'Creator',
    toneHint: 'imaginative, refined, original, design-led',
    description: 'Originality, self-expression, craft, aesthetic value.',
  },
  {
    id: 'caregiver',
    label: 'Caregiver',
    toneHint: 'supportive, warm, helpful, reassuring',
    description: 'Care, service, protection, trust, reliability.',
  },
  {
    id: 'everyman',
    label: 'Everyman',
    toneHint: 'friendly, accessible, practical, honest',
    description: 'Belonging, simplicity, value, everyday usefulness.',
  },
  {
    id: 'lover',
    label: 'Lover',
    toneHint: 'sensory, aspirational, elegant, emotional',
    description: 'Desire, beauty, indulgence, experience, emotional pull.',
  },
  {
    id: 'magician',
    label: 'Magician',
    toneHint: 'transformational, visionary, surprising, inspiring',
    description: 'Transformation, possibility, aspiration, delight.',
  },
  {
    id: 'outlaw',
    label: 'Outlaw',
    toneHint: 'provocative, direct, challenger, rebellious',
    description: 'Challenge, disruption, anti-convention, edge.',
  },
  {
    id: 'jester',
    label: 'Jester',
    toneHint: 'playful, witty, light, entertaining',
    description: 'Fun, spontaneity, humor, participation.',
  },
  {
    id: 'innocent',
    label: 'Innocent',
    toneHint: 'simple, optimistic, clean, transparent',
    description: 'Trust, simplicity, optimism, purity, safety.',
  },
];

export const EMPTY_BRAND_PROFILE: BrandProfile = {
  description: '',
  archetype: '',
  secondaryArchetype: '',
  toneOfVoice: '',
  icps: [],
};

export function createEmptyIcp(): BrandICP {
  return {
    id: `icp_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    name: '',
    description: '',
    needs: '',
    objections: '',
    preferredMessages: '',
    priceSensitivity: 'medium',
  };
}

export function normalizeBrandProfile(profile: BrandProfile | null | undefined): BrandProfile {
  const primary = profile?.archetype ?? '';
  const secondary = profile?.secondaryArchetype === primary ? '' : profile?.secondaryArchetype ?? '';
  return {
    ...EMPTY_BRAND_PROFILE,
    ...(profile ?? {}),
    archetype: primary,
    secondaryArchetype: secondary,
    icps: Array.isArray(profile?.icps) ? profile.icps : [],
  };
}

export async function saveBrandProfile(brandId: string, profile: BrandProfile): Promise<void> {
  const clean: BrandProfile = {
    description: profile.description.trim(),
    archetype: profile.archetype,
    secondaryArchetype: profile.secondaryArchetype && profile.secondaryArchetype !== profile.archetype
      ? profile.secondaryArchetype
      : '',
    toneOfVoice: profile.toneOfVoice.trim(),
    icps: profile.icps
      .map((icp) => ({
        ...icp,
        name: icp.name.trim(),
        description: icp.description.trim(),
        needs: icp.needs.trim(),
        objections: icp.objections.trim(),
        preferredMessages: icp.preferredMessages.trim(),
      }))
      .filter((icp) => icp.name || icp.description || icp.needs || icp.preferredMessages),
    updatedAt: new Date().toISOString(),
  };
  await FirestoreService.updateDocument('brands', brandId, { brandProfile: clean });
}

export function formatBrandProfileForPrompt(profile: BrandProfile | null | undefined): string {
  const p = normalizeBrandProfile(profile);
  const lines: string[] = [];
  if (p.description.trim()) lines.push(`Brand profile: ${p.description.trim()}`);
  if (p.archetype) {
    const archetype = BRAND_ARCHETYPES.find((a) => a.id === p.archetype);
    lines.push(`Primary brand archetype: ${archetype?.label ?? p.archetype}${archetype ? ` — ${archetype.description}` : ''}`);
  }
  if (p.secondaryArchetype) {
    const archetype = BRAND_ARCHETYPES.find((a) => a.id === p.secondaryArchetype);
    lines.push(`Complementary brand archetype: ${archetype?.label ?? p.secondaryArchetype}${archetype ? ` — ${archetype.description}` : ''}`);
  }
  if (p.toneOfVoice.trim()) lines.push(`Tone of voice: ${p.toneOfVoice.trim()}`);
  const icps = p.icps.filter((icp) => icp.name || icp.description).slice(0, 5);
  if (icps.length > 0) {
    lines.push('ICPs:');
    for (const icp of icps) {
      lines.push(
        `- ${icp.name || 'ICP'}: ${[
          icp.description,
          icp.needs ? `needs: ${icp.needs}` : '',
          icp.objections ? `objections: ${icp.objections}` : '',
          icp.preferredMessages ? `messages: ${icp.preferredMessages}` : '',
          `price sensitivity: ${icp.priceSensitivity}`,
        ].filter(Boolean).join(' | ')}`
      );
    }
  }
  return lines.length > 0
    ? lines.join('\n')
    : '(Δεν έχει συμπληρωθεί Brand Profile. Μη μαντεύεις archetype/tone/ICP.)';
}
