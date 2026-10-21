import { Module } from '@nestjs/common';
import { DeviceState } from './device-state.js';
import { DevicesController } from './devices.controller.js';
import { OperatorController } from '../operator/operator.controller.js';

@Module({
  controllers: [DevicesController, OperatorController],
  providers: [DeviceState],
  exports: [DeviceState],
})
export class DevicesModule {}
