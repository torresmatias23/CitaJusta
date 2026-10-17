import 'reflect-metadata';
import { BadRequestException, HttpException } from '@nestjs/common';
import { NagerDateHolidaysAdapter } from '../dist/availability/nager-date-holidays.adapter.js';

try {
  const args = process.argv.slice(2);
  if (args.length !== 1 || !/^\d{4}$/.test(args[0])) {
    throw new BadRequestException('Uso: npm run holidays:query -w @citajusta/api -- YYYY (1900–2100)');
  }
  const data = await new NagerDateHolidaysAdapter().findByYear(Number(args[0]));
  console.log(JSON.stringify({ data }, null, 2));
} catch (error) {
  console.error(error instanceof HttpException ? error.message : 'Holiday query failed');
  process.exitCode = 1;
}
