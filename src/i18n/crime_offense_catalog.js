import { formatOffenseLabel } from '../utils/crime_taxonomy.js';
import { installCrimeOffenseCatalog } from './crime_offenses.js';

installCrimeOffenseCatalog(formatOffenseLabel);
