'use strict';

// 世界风物内容包（subpackage）：联合国粮农组织「全球重要农业文化遗产」(GIAHS)
// 及相关公开资料。每一站都有可核对的公开来源与开放许可照片；这里是全球视野的
// 阅读层，不提供行程规划、预约或到访安排——可规划的参考行程仍以河南示范区域为准。
const sites = [
  {
    id: 'hani-terraces',
    name: '红河哈尼稻作梯田',
    nameEn: 'Honghe Hani Rice Terraces',
    country: '中国 · 云南', enCountry: 'Yunnan, China',
    continent: '亚洲', enContinent: 'Asia',
    theme: '稻作文化 · 梯田生态', enTheme: 'Rice culture · terrace ecology',
    designation: '2010 年入选 GIAHS；2013 年列入世界遗产', enDesignation: 'GIAHS 2010 · World Heritage 2013',
    description: '一千三百年间，哈尼族和周边民族在哀牢山刻出级级稻田，森林—村寨—梯田—水系同构的农业生态延续至今。',
    enDescription: 'For thirteen centuries the Hani people and their neighbours have carved rice paddies into the Ailao Mountains, sustaining a farming ecosystem where forest, village, terraces and water system work as one.',
    facts: [
      { text: '红河哈尼稻作梯田系统于 2010 年被联合国粮农组织列为全球重要农业文化遗产，梯田核心区位于云南省元阳县红河沿岸。', enText: 'The Honghe Hani Rice Terraces were designated a GIAHS site by FAO in 2010; the core terraces lie along the Red River in Yuanyang County, Yunnan.', sourceIds: ['W1', 'W2'] },
      { text: '2013 年，「红河哈尼梯田文化景观」列入联合国教科文组织《世界遗产名录》，其森林、村寨、梯田和水系「四素同构」的景观被认定为活态农业文化系统。', enText: 'In 2013 the Cultural Landscape of Honghe Hani Rice Terraces entered the UNESCO World Heritage List as a living agricultural system of forest, village, terrace and water.', sourceIds: ['W2'] }
    ],
    sources: [
      { id: 'W1', title: '粮农组织全球重要农业文化遗产（GIAHS）', publisher: 'FAO', url: 'https://www.fao.org/giahs/en/' },
      { id: 'W2', title: 'Honghe Hani Rice Terraces', publisher: 'Wikipedia（英文）', url: 'https://en.wikipedia.org/wiki/Honghe_Hani_Rice_Terraces' }
    ],
    photo: {
      src: '/packageWorld/assets/hani-terraces.jpg',
      caption: '云南元阳 · 哈尼梯田日出',
      credit: 'Kcx36 · CC BY-SA 2.0',
      creator: 'Kcx36',
      sourceUrl: 'https://commons.wikimedia.org/wiki/File:Yuanyang_Hani_Rice_Terraces_at_Sunrise.jpg',
      licenseUrl: 'https://creativecommons.org/licenses/by-sa/2.0/'
    }
  },
  {
    id: 'ifugao-terraces',
    name: '伊富高稻米梯田',
    nameEn: 'Rice Terraces of the Philippine Cordilleras',
    country: '菲律宾 · 吕宋', enCountry: 'Luzon, Philippines',
    continent: '亚洲', enContinent: 'Asia',
    theme: '山地稻作 · 灌溉智慧', enTheme: 'Mountain rice · irrigation wisdom',
    designation: '2002 年 GIAHS 首批试点；1995 年列入世界遗产', enDesignation: 'GIAHS pilot 2002 · World Heritage 1995',
    description: '巴纳韦一带的梯田由伊富高人在山脊上垒石而成，自流灌溉系统运转了约两千年，是活着的山地稻作文明。',
    enDescription: 'Around Banaue the Ifugao built stone-walled terraces on mountain ridges, with gravity-fed irrigation running for some two thousand years — a living mountain rice civilisation.',
    facts: [
      { text: '菲律宾科迪勒拉山的稻米梯田于 1995 年列入《世界遗产名录》，是首批以活态稻作文化景观入选的农业遗产之一。', enText: 'The Rice Terraces of the Philippine Cordilleras joined the World Heritage List in 1995 among the first living rice-culture landscapes ever inscribed.', sourceIds: ['W3', 'W1'] },
      { text: '伊富高梯田及其传统灌溉体系是粮农组织全球重要农业文化遗产计划 2002 年启动时的首批试点地区。', enText: 'The Ifugao terraces and their traditional irrigation were among the first pilot sites when FAO launched the GIAHS programme in 2002.', sourceIds: ['W1', 'W4'] }
    ],
    sources: [
      { id: 'W3', title: 'Rice Terraces of the Philippine Cordilleras', publisher: 'Wikipedia（英文）', url: 'https://en.wikipedia.org/wiki/Rice_Terraces_of_the_Philippine_Cordilleras' },
      { id: 'W4', title: 'Banaue', publisher: 'Wikipedia（英文）', url: 'https://en.wikipedia.org/wiki/Banaue' },
      { id: 'W1', title: '粮农组织全球重要农业文化遗产（GIAHS）', publisher: 'FAO', url: 'https://www.fao.org/giahs/en/' }
    ],
    photo: {
      src: '/packageWorld/assets/ifugao-terraces.jpg',
      caption: '菲律宾巴纳韦 · 稻米梯田',
      credit: 'Cccefalon · CC BY-SA 3.0',
      creator: 'Cccefalon',
      sourceUrl: 'https://commons.wikimedia.org/wiki/File:Banaue_Philippines_Banaue-Rice-Terraces-01.jpg',
      licenseUrl: 'https://creativecommons.org/licenses/by-sa/3.0/'
    }
  },
  {
    id: 'sado-tanada',
    name: '佐渡里山与棚田',
    nameEn: 'Sado Satoyama and Rice Paddies',
    country: '日本 · 新潟', enCountry: 'Niigata, Japan',
    continent: '亚洲', enContinent: 'Asia',
    theme: '里山里海 · 人鸟共栖', enTheme: 'Satoyama · people and crested ibis',
    designation: '2011 年入选 GIAHS', enDesignation: 'GIAHS 2011',
    description: '佐渡岛的梯田与村落维持着「里山」式耕作，减少农药的传统让朱鹮重新回到水田觅觅，成为人与濒危物种共生的样本。',
    enDescription: 'Sado Island keeps satoyama-style farming in its terraces and villages; reduced-pesticide traditions have brought the crested ibis back to the paddies — a model of people and endangered species coexisting.',
    facts: [
      { text: '日本佐渡岛的里山与稻作系统于 2011 年被列为全球重要农业文化遗产，其特色在于与珍稀鸟类朱鹮共生的低农药稻作方式。', enText: 'Listed as a GIAHS site in 2011, Sado\'s satoyama and rice system is known for low-pesticide rice farming that coexists with the rare crested ibis.', sourceIds: ['W5', 'W1'] },
      { text: '朱鹮（学名 Nipponia nippon）曾在野外几乎灭绝，经过中日两国的保护与繁育，佐渡的水田重新成为其野外觅食地。', enText: 'The crested ibis (Nipponia nippon) was once nearly extinct in the wild; after protection and breeding in China and Japan, Sado\'s paddies became its feeding grounds again.', sourceIds: ['W6'] }
    ],
    sources: [
      { id: 'W5', title: 'Sado Island', publisher: 'Wikipedia（英文）', url: 'https://en.wikipedia.org/wiki/Sado_Island' },
      { id: 'W6', title: 'Crested ibis', publisher: 'Wikipedia（英文）', url: 'https://en.wikipedia.org/wiki/Crested_ibis' },
      { id: 'W1', title: '粮农组织全球重要农业文化遗产（GIAHS）', publisher: 'FAO', url: 'https://www.fao.org/giahs/en/' }
    ],
    photo: {
      src: '/packageWorld/assets/sado-tanada.jpg',
      fit: 'aspectFit',
      caption: '日本佐渡 · 岩首正龙棚田',
      credit: 'Sadoite · CC BY-SA 2.0',
      creator: 'Sadoite',
      sourceUrl: 'https://commons.wikimedia.org/wiki/File:Iwakubi_shoryu_tanada.jpg',
      licenseUrl: 'https://creativecommons.org/licenses/by-sa/2.0/'
    }
  },
  {
    id: 'chiloe-potatoes',
    name: '奇洛埃群岛农业',
    nameEn: 'Chiloé Agriculture',
    country: '智利 · 湖区', enCountry: 'Los Lagos, Chile',
    continent: '南美洲', enContinent: 'South America',
    theme: '土豆原乡 · 品种宝库', enTheme: 'Potato homeland · variety treasury',
    designation: 'GIAHS 首批试点地区之一', enDesignation: 'One of the first GIAHS pilot sites',
    description: '奇洛埃群岛是马铃薯重要的起源地之一，岛民世代保留数百个地方品种，彩色土豆至今仍在家庭菜园里传递。',
    enDescription: 'Chiloé is one of the great origins of the potato; islanders have kept hundreds of local varieties for generations, and colourful potatoes still pass between household gardens today.',
    facts: [
      { text: '智利奇洛埃群岛是马铃薯的起源中心之一，当地农民长期保留着数百种地方品种，是全球马铃薯遗传多样性的重要库藏。', enText: 'The Chiloé archipelago is one of the potato\'s centres of origin; its farmers have long kept hundreds of local varieties, a major reservoir of global potato diversity.', sourceIds: ['W7', 'W1'] },
      { text: '奇洛埃传统农业系统是粮农组织全球重要农业文化遗产计划启动时的首批试点地区之一，与菲律宾伊富高梯田等同批入选。', enText: 'Chiloé\'s traditional agriculture was among the first pilot sites when the GIAHS programme launched, selected alongside the Ifugao terraces of the Philippines.', sourceIds: ['W1', 'W7'] }
    ],
    sources: [
      { id: 'W7', title: 'Chiloé Archipelago', publisher: 'Wikipedia（英文）', url: 'https://en.wikipedia.org/wiki/Chilo%C3%A9_Archipelago' },
      { id: 'W1', title: '粮农组织全球重要农业文化遗产（GIAHS）', publisher: 'FAO', url: 'https://www.fao.org/giahs/en/' }
    ],
    photo: {
      src: '/packageWorld/assets/chiloe-potatoes.jpg',
      caption: '智利奇洛埃 · 彩色土豆',
      credit: 'Spedona · CC BY 2.0',
      creator: 'Spedona',
      sourceUrl: 'https://commons.wikimedia.org/wiki/File:Papas_de_colores_de_Chiloe.jpg',
      licenseUrl: 'https://creativecommons.org/licenses/by/2.0/'
    }
  },
  {
    id: 'atlas-oasis',
    name: '阿特拉斯绿洲农业',
    nameEn: 'Oases of the Atlas Mountains',
    country: '摩洛哥 · 阿特拉斯', enCountry: 'Atlas Mountains, Morocco',
    continent: '非洲', enContinent: 'Africa',
    theme: '绿洲农业 · 抗旱智慧', enTheme: 'Oasis farming · drought wisdom',
    designation: '2011 年入选 GIAHS', enDesignation: 'GIAHS 2011',
    description: '在山脉与沙漠之间，绿洲农民用棕榈遮荫、分层种植，让枣椰、果树与作物在同一片土地上各得其所。',
    enDescription: 'Between mountains and desert, oasis farmers use palm shade and layered planting so that date palms, fruit trees and crops each find their place on the same land.',
    facts: [
      { text: '摩洛哥阿特拉斯山脉的绿洲农业系统于 2011 年被列为全球重要农业文化遗产，其层层遮荫、多元混作的种植结构是干旱区农业的适应样本。', enText: 'The oasis farming system of Morocco\'s Atlas Mountains was listed as a GIAHS site in 2011; its tiered shade and mixed planting are a model of dryland adaptation.', sourceIds: ['W8'] },
      { text: '菲吉格（Figuig）等绿洲城镇依赖泉水与枣椰林维持农业生活，枣椰树的遮荫为下层作物创造了可耕种的小气候。', enText: 'Oasis towns such as Figuig rely on springs and date-palm groves; the palms\' shade creates a farmable micro-climate for the crops below.', sourceIds: ['W9', 'W10'] }
    ],
    sources: [
      { id: 'W8', title: '粮农组织全球重要农业文化遗产（GIAHS）', publisher: 'FAO', url: 'https://www.fao.org/giahs/en/' },
      { id: 'W9', title: 'Figuig', publisher: 'Wikipedia（英文）', url: 'https://en.wikipedia.org/wiki/Figuig' },
      { id: 'W10', title: 'Anti-Atlas', publisher: 'Wikipedia（英文）', url: 'https://en.wikipedia.org/wiki/Anti-Atlas' }
    ],
    photo: {
      src: '/packageWorld/assets/atlas-oasis.jpg',
      caption: '摩洛哥小阿特拉斯 · 绿洲村落',
      credit: 'Slapostol · CC BY-SA 4.0',
      creator: 'Slapostol',
      sourceUrl: 'https://commons.wikimedia.org/wiki/File:Anti-Atlas_oasis_village.jpg',
      licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/'
    }
  },
  {
    id: 'barroso-hills',
    name: '巴罗舒农林牧系统',
    nameEn: 'Barroso Agro-silvo-pastoral System',
    country: '葡萄牙 · 北部', enCountry: 'Northern Portugal',
    continent: '欧洲', enContinent: 'Europe',
    theme: '农牧混作 · 高原牧场', enTheme: 'Agro-silvo-pastoral · highland commons',
    designation: '2018 年入选 GIAHS', enDesignation: 'GIAHS 2018',
    description: '葡萄牙北部的巴罗舒高地保留着放牧、耕种与林业并存的混作传统，村庄与田块嵌在山丘之间，是欧洲低投入农业的活样本。',
    enDescription: 'The Barroso uplands of northern Portugal keep a mixed tradition of grazing, cropping and forestry, with villages and small fields set among hills — a living sample of Europe\'s low-input farming.',
    facts: [
      { text: '葡萄牙巴罗舒的农林牧系统于 2018 年被联合国粮农组织列为全球重要农业文化遗产，以放牧、种植与林业并存的传统混作方式入选。', enText: 'FAO listed the Barroso agro-silvo-pastoral system as a GIAHS site in 2018 for its combined grazing, cropping and forestry.', sourceIds: ['W11', 'W1'] },
      { text: '巴罗舒位于葡萄牙北部山区，高原牧场与小型田块交错，村落景观保存完整，是欧洲传统农业文化的代表区域之一。', enText: 'In the northern Portuguese mountains, highland commons interleave with small fields and intact village landscapes — one of Europe\'s representative traditional farming regions.', sourceIds: ['W11'] }
    ],
    sources: [
      { id: 'W11', title: 'Barroso', publisher: 'Wikipedia（英文）', url: 'https://en.wikipedia.org/wiki/Barroso' },
      { id: 'W1', title: '粮农组织全球重要农业文化遗产（GIAHS）', publisher: 'FAO', url: 'https://www.fao.org/giahs/en/' }
    ],
    photo: {
      src: '/packageWorld/assets/barroso-hills.jpg',
      caption: '葡萄牙巴罗舒 · 科瓦什村山地',
      credit: 'GFreihalter · CC BY-SA 3.0',
      creator: 'GFreihalter',
      sourceUrl: 'https://commons.wikimedia.org/wiki/File:Covas_do_Barroso_Santa_Maria_333.jpg',
      licenseUrl: 'https://creativecommons.org/licenses/by-sa/3.0/'
    }
  }
];

module.exports = { sites };
