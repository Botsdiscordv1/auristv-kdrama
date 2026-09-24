import('dotenv').then(d => d.config());
const { ScheduleRepository } = require('./src/repositories/ScheduleRepository');
const { AnimeRepository } = require('./src/repositories/AnimeRepository');

async function main() {
  console.log('=== Test: New Architecture ===\n');

  const scheduleRepo = new ScheduleRepository();
  const animeRepo = new AnimeRepository();

  // 1. Schedule
  console.log('1. ScheduleAggregator via ScheduleRepository...');
  const schedule = await scheduleRepo.getSchedule();
  console.log(`   Total: ${schedule.total}, Days: ${schedule.days.length}, Season: ${schedule.season}`);
  if (schedule.days?.[0]?.items?.length) {
    const first = schedule.days[0].items[0];
    console.log(`   First item: "${first.title}" (ep ${first.episode})`);
  }

  // 2. Trending
  console.log('\n2. AnimeAggregator via AnimeRepository (trending)...');
  const trending = await animeRepo.getTrending();
  console.log(`   Items: ${trending.length}`);
  if (trending.length) {
    console.log(`   First: "${trending[0].title}" score=${trending[0].score} banner=${!!trending[0].banner}`);
  }

  // 3. Search
  console.log('\n3. AnimeAggregator search...');
  const search = await animeRepo.search('Jujutsu Kaisen');
  console.log(`   Results: ${search.length}`);
  if (search.length) {
    console.log(`   First: "${search[0].title}" sources=${search[0].availableSources.join(',')}`);
  }

  // 4. Detail
  console.log('\n4. AnimeAggregator detail...');
  const detail = await animeRepo.getDetail('Jujutsu Kaisen');
  console.log(`   Title: "${detail?.title}"`);
  console.log(`   Score: ${detail?.score}`);
  console.log(`   Genres: ${detail?.genres?.join(', ')}`);
  console.log(`   Banner: ${!!detail?.banner}`);

  console.log('\n=== All tests passed ===');
}

main().catch(console.error);