/**
 * English strings, bundled so first paint never shows raw keys.
 * Other languages load on demand from messages/<namespace>/<code>.json.
 */
import common from './messages/common/en.json';
import nav from './messages/nav/en.json';
import home from './messages/home/en.json';
import game from './messages/game/en.json';
import map from './messages/map/en.json';
import ranked from './messages/ranked/en.json';
import shop from './messages/shop/en.json';
import leaderboard from './messages/leaderboard/en.json';
import guide from './messages/guide/en.json';
import profile from './messages/profile/en.json';
import achievements from './messages/achievements/en.json';
import waitlist from './messages/waitlist/en.json';
import partnership from './messages/partnership/en.json';
import settings from './messages/settings/en.json';
import account from './messages/account/en.json';
import admin from './messages/admin/en.json';
import partner from './messages/partner/en.json';
import versus from './messages/versus/en.json';
import challenge from './messages/challenge/en.json';
import themes from './messages/themes/en.json';
import referral from './messages/referral/en.json';
import mascots from './messages/mascots/en.json';
import onboarding from './messages/onboarding/en.json';
import quests from './messages/quests/en.json';
import notfound from './messages/notfound/en.json';

export const EN = { common, nav, home, game, map, ranked, shop, leaderboard, guide, profile, achievements, waitlist, partnership, settings, account, admin, partner, versus, challenge, themes, referral, mascots, onboarding, quests, notfound } as Record<string, Record<string, string>>;

export type Namespace = 'common' | 'nav' | 'home' | 'game' | 'map' | 'ranked' | 'shop' | 'leaderboard' | 'guide' | 'profile' | 'achievements' | 'waitlist' | 'partnership' | 'settings' | 'account' | 'admin' | 'partner' | 'versus' | 'challenge' | 'themes' | 'referral' | 'mascots' | 'onboarding' | 'quests' | 'notfound';
