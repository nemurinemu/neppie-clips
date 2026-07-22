export interface SocialLink {
  label: string;
  url: string;
}

export const site = {
  title: 'Neppie clips',

  // Drop a banner at public/banner.png (design ~2080×520, displays ~1040×260).
  // Set to null to show the text title instead.
  bannerSrc: '/banner.webp' as string | null,

  aboutHtml: `I love neppie!!! And I make a lot of clips with neppie. But how do you even find the clips?! You find them here.
  <br><br>
  This website features all clips that I've made, including those posted to neppie's discord server, my twitter, my youtube channel and neppie clips youtube channel. 
  New clips will appear here as soon as I post them anywhere else.
  <br>
  Except for twitch clips!! You can find those on Katabasis clips website below!<br><br> 
 `,

  links: {
    neppie: [
      { label: 'Neppie Twitter', url: 'https://x.com/neppie_nep' },
      { label: 'Neppie Twitch', url: 'https://twitch.tv/neppienep' },
      { label: 'Neppie YouTube', url: 'https://youtube.com/@neppienep' },
      { label: 'More Neppie links', url: 'https://neppie.carrd.co' },
    ],
    friends: [
      { label: 'Katabasis website', url: 'https://katabasis.moe' },
      { label: 'neppienep.info', url: 'https://neppienep.info' },
      {
        label: 'Katabasis Twitch clips',
        url: 'https://katabasis.onlymans.site',
      },
      {
        label: 'Neppie clips (Youtube)',
        url: 'https://youtube.com/@neppieclips',
      },
    ] as SocialLink[],
    me: [
      { label: 'My Twitter', url: 'https://x.com/_nemurinemu' },
      { label: 'My Youtube', url: 'https://www.youtube.com/@nemurinemunemu' },
    ] as SocialLink[],
  },
};
