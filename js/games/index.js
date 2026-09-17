import { Klondike } from './klondike.js';
import { Spider } from './spider.js';
import { FreeCell } from './freecell.js';
import { Pyramid } from './pyramid.js';
import { TriPeaks } from './tripeaks.js';

export const GAMES = [Klondike, Spider, FreeCell, Pyramid, TriPeaks];
export const GAME_BY_ID = Object.fromEntries(GAMES.map((G) => [G.meta.id, G]));
