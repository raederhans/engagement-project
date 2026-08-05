import taxonomy from '../data/crime_taxonomy.v1.json' with { type: 'json' };

const OFFENSE_INDEX = new Map();

for (const theme of taxonomy.themes) {
  for (const category of theme.ucr_categories) {
    for (const offense of category.offenses) {
      OFFENSE_INDEX.set(offense.code, Object.freeze({ theme, category, offense }));
    }
  }
}

function localizedLabel(label, language) {
  return label?.[language] || label?.en || '';
}

export const crimeTaxonomy = taxonomy;
export const CRIME_TAXONOMY_VERSION = taxonomy.taxonomy_version;

export function listOffenseThemes(language = 'en') {
  return taxonomy.themes.map((theme) => Object.freeze({
    id: theme.id,
    label: localizedLabel(theme.label, language),
    offenseCount: theme.ucr_categories.reduce((sum, category) => sum + category.offenses.length, 0),
  }));
}

export function describeOffense(code, language = 'en') {
  const entry = OFFENSE_INDEX.get(code);
  if (!entry) return null;
  const { theme, category, offense } = entry;
  return Object.freeze({
    themeId: theme.id,
    themeLabel: localizedLabel(theme.label, language),
    ucrCode: category.code,
    ucrLabel: localizedLabel(category.label, language),
    offenseCode: offense.code,
    offenseLabel: localizedLabel(offense.label, language),
  });
}

export function formatOffenseLabel(code, language = 'en') {
  const description = describeOffense(code, language);
  if (!description) return code;
  return description.offenseLabel;
}
