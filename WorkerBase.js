/**
 * Created by zhuqizhong on 16-11-10.
 */
let child_process = require('child_process');
let SendMessage = require('sendmessage');
let event = require('events');
let util = require('util');
let _ = require('lodash');
let PDUtils = require('./PDUtils');
const InfinitLoop = require('./InfinitLoop');
const async = require('async-q');
const Q = require('q');
const MAX_WRITE_CNT = 50;
const consts = require('./consts');
let Lock = require('lock');
let lock = Lock();

/**
 * 几个数据结构
 * epToRegs[deviceId][ep] = [regs]
 * regToEps[regName] = [{deviceId:devId,epId:epId}]
 */
/**
 * 客户端代理
 * @param type
 * @constructor
 *
 *
 */
function WorkerBase(maxSegLength, minGapLength) {
    event.EventEmitter.call(this);
    this.minGapLength = minGapLength;
    this.maxSegLength = maxSegLength;
    this.readRegValues = {};
    //待写入的寄存器信息
    this.writeRegValues = [];
    this.pendReadRegs = [];
    this.autoReadMaps = {};
    this.memories = {};
    this.epToRegs = {};
    this.regToEps = {};
    this.wqs_latch = {};
    this.wqs_target = {};
    this.PresetAutoreadRegs = {};
    this.RUNNING_STATE = {
        'IDLE': 0,
        'CONNECTING': 1,
        'CONNECTED': 2
    };

    this.options = {};
    this.runningState = this.RUNNING_STATE.IDLE;

    process.on('message', function (msg) {
        switch (msg.cmd) {
            case 'drvInit':
                //  this.memories = PDUtils.ParseMemories(msg.memories);
                this.initDriver(msg.options);
                // this.rebuildMemMap();
                break;
            case 'epsInit':
                this.EpsInit(msg.deviceId, msg.epRegs, msg.devSpecOpt);
                break;
            case 'upRegs':
                if (msg.regs) {

                    if (this.writeRegValues.length < MAX_WRITE_CNT) {
                        this.writeRegValues.push({
                            uuid: msg.uuid,
                            target: this.CreateRegsObj(msg.regs),
                            time: new Date(),
                            timeout: msg.timeout || 2000000
                        });
                        this.emit('UpdateRegs', {});
                    } else {
                        this.SendExecResponse('upRegResp', msg.uuid, {success: false, reason: 'Pending Queue full'});
                    }

                }
                break;
            case 'modifyAutoReadRegs':  //添加要重新读取的寄存器
                if (msg.action === 'add') {
                    PDUtils.ConcatMemories(this.memories, msg.memories);
                    this.rebuildMemMap();
                } else {
                    PDUtils.RemoveMemories(this.memories, msg.memories);
                    this.rebuildMemMap();
                }
                break;
            case 'callRegs':
                if (msg.regs) {
                    if (this.writeRegValues.length < MAX_WRITE_CNT) {
                        this.pendReadRegs.push({
                            uuid: msg.uuid,
                            target: msg.regs,
                            time: new Date(),
                            timeout: msg.timeout || 2000
                        });
                        this.emit('CallRegs', {});
                    } else {
                        this.SendExecResponse('callRegResp', msg.uuid, {success: false, reason: 'Pending Queue full'});
                    }
                }

                break;
            case 'setInOrEx':
                this.setInOrEx(msg);
                break;

            default:
                console.error('error message:', JSON.stringify(msg));
                break;
        }
    }.bind(this));
    SendMessage(process, {cmd: 'inited'});
}
util.inherits(WorkerBase, event.EventEmitter);

/**
 * 初始化驱动
 * @param options  从配置里传来的一些参数
 * @param memories
 */
WorkerBase.prototype.initDriver = function (options, memories) {
    let error = ('initDriver must be defined!');

    console.error(error);
    throw new Error(error);

};
/**
 * 初始化DataPoint
 * @param deviceId      对应的设备ID号
 * @param regInfos      每个dp对应的寄存器信息
 * @constructor
 */
WorkerBase.prototype.EpsInit = function (deviceId, regInfos, devSpecOpts) {
    //创建关于driverInstName dx 到regs的映射表
    this.devSpecOpts = this.devSpecOpts || {};
    this.devSpecOpts[deviceId] = devSpecOpts;
    //需要的是关联信息
    /* epToRegs[deviceId][ep] = [regs]
     * regToEps[regName] = [{deviceId:devId,epId:epId}] */

    //针对每一个option，可能会有多个driverInstName
    this.epToRegs[deviceId] = this.epToRegs[deviceId] || {};
    _.each(regInfos, function (regs, epId) {
        //记录从EP到寄存器的映射
        this.epToRegs[deviceId][epId] = regs;

        //分析每一个regs信息
        _.each(regs, function (regName) {
            this.regToEps[regName] = this.regToEps[regName] || [];

            this.regToEps[regName].push({deviceId: deviceId, epId: epId});

            //创建一个空的读寄存器信息
            this.readRegValues[regName] = undefined;
        }.bind(this));
    }.bind(this));
    //regToEps
    let addMemories = {};
    _.each(_.keys(this.regToEps), function (memoryId) {
        let regDef = PDUtils.splitRegDef(memoryId);
        if (regDef) {
            if (!addMemories[regDef.devId]) {
                addMemories[regDef.devId] = {};
            }
            if (!addMemories[regDef.devId][regDef.memTag]) {
                addMemories[regDef.devId][regDef.memTag] = [];
            }
            addMemories[regDef.devId][regDef.memTag].push(parseInt(regDef.memIndex));
        }

    });
    PDUtils.ConcatMemories(this.memories, addMemories, true);
    this.rebuildMemMap();
};

WorkerBase.prototype.CreateRegsObj = function (regInfos) {
    let self = this;
    let targetRegs = {};
    _.each(regInfos, function (regValue, regId) {
        //regID  id0:BI.1
        let regDef = PDUtils.splitRegDef(regId);
        if (regDef) {
            if (!targetRegs[regDef.devId]) {
                targetRegs[regDef.devId] = {}
            }
            if (!targetRegs[regDef.devId][regDef.memTag]) {
                targetRegs[regDef.devId][regDef.memTag] = {};
            }
            targetRegs[regDef.devId][regDef.memTag][regDef.memIndex] = regValue;
        }
    });
    return targetRegs;
};
/**
 * 这个函数将读取到新的regs的数据后被触发，
 * 它根据当前变化过的数据值，寻找受影响的DP，并且发送相应的dpxchange消息
 * @param modifiedRegs  变化过的寄存器列表
 */
WorkerBase.prototype.OnRegModified = function (modified_regs) {
    /* epToRegs[deviceId][ep] = [regs]
     * regToEps[regName] = [{deviceId:devId,epId:epId}] */

    // console.log('modified regs:',modified_regs);
    let infectedEps = {};
    //生成受影响的device/endpoint列表
    _.each(modified_regs, function (oneReg) {
        //dp里包括两项：driverInst和dpId,需要通过这个反向寻找对应的寄存器是哪些
        _.each(this.regToEps[oneReg], function (epItem) {
            if (!infectedEps[epItem.deviceId]) {
                infectedEps[epItem.deviceId] = {};
            }
            infectedEps[epItem.deviceId][epItem.epId] = {};
            //把相应的数据设置起来
            _.each(this.epToRegs[epItem.deviceId][epItem.epId], function (regOfEp) {
                infectedEps[epItem.deviceId][epItem.epId][regOfEp] = this.readRegValues[regOfEp];
            }.bind(this));

        }.bind(this));
    }.bind(this));
    // console.log('infected eps:',JSON.stringify(infectedEps));
    _.each(infectedEps, function (changedEps, deviceId) {
        _.each(changedEps, function (epRegValues, epId) {
            SendMessage(process, {cmd: 'dpxChanged', deviceId: deviceId, ep: epId, regs: epRegValues});
        })
    });

    return modified_regs;

};
WorkerBase.prototype.SetAutoReadConfig = function (newConfig) {

    let match = ["year", "month", "day", "hour", "minute", "second"];
    let extractor = ["getYear", "getMonth", "getDate", "getHours", "getMinutes", "getSeconds"]

    function shouldRead(matcher) {

        let curTime = new Date();
        let matched = true;

        for (let i = 0; i < 6; i++) {
            if (matcher[i] !== undefined) {
                if (!matcher[i](curTime[extractor[i]]())) {
                    matched = false;
                    break;
                }

            }
        }
        return matched;
    }

    let newPresetAutoreadRegs = {};
    _.each(newConfig, function (wqs, devId) {
        newPresetAutoreadRegs[devId] = {};
        _.each(wqs, function (wqDef, ep) {
            if (wqDef.interval) {
                //先随机设置个少于20秒的数，在20秒内先读一次。
                newPresetAutoreadRegs[devId][ep] = {interval: wqDef.interval, remain: parseInt(Math.random() * 20) + 1}
            } else if (wqDef.readTime) {
                let firstDefFound = false;
                let matcher = [];
                for (let i = 0; i < 6; i++) {
                    if (wqDef.readTime[match[i]] === undefined) {
                        if (firstDefFound) {
                            matcher.push(function (data) {
                                return data === 0;
                            });
                        } else {
                            matcher.push(function (data) {
                                return true
                            });
                        }
                    } else {
                        let def = wqDef.readTime[match[i]];
                        if (_.isNumber(def)) {
                            firstDefFound = true;
                            matcher.push(function (data) {
                                return data === def;
                            });
                        } else {
                            try {
                                let func = eval("(" + def + ")");
                                firstDefFound = true;
                                matcher.push(func);
                            } catch (e) {
                                console.error('definition error:', e.message || e);
                            }
                        }
                    }
                }
                if (firstDefFound) {
                    newPresetAutoreadRegs[devId][ep] = {matcher: shouldRead.bind(this, matcher)}
                }
            }
        })
    });

    this.PresetAutoreadRegs = newPresetAutoreadRegs;
    this.setupPredefineReadInterval();
}
/**
 * 重新创建需要读取的数据映射表
 */
WorkerBase.prototype.rebuildMemMap = function () {
    this.autoReadMaps = this.autoReadMaps || {}
    if (_.isEmpty(this.PresetAutoreadRegs)) {
        _.each(this.memories, function (memoryDef, devId) {
            this.autoReadMaps[devId] = this.autoReadMaps[devId] || {};
            this.autoReadMaps[devId].bi_map = PDUtils.CreateMapArray(memoryDef.BI, this.maxSegLength, this.minGapLength);
            this.autoReadMaps[devId].bq_map = PDUtils.CreateMapArray(memoryDef.BQ, this.maxSegLength, this.minGapLength);
            this.autoReadMaps[devId].bp_map = PDUtils.CreateMapArray(memoryDef.BP, this.maxSegLength, this.minGapLength);
            this.autoReadMaps[devId].wi_map = PDUtils.CreateMapArray(memoryDef.WI, this.maxSegLength, this.minGapLength);
            this.autoReadMaps[devId].wq_map = PDUtils.CreateMapArray(memoryDef.WQ, this.maxSegLength, this.minGapLength);
        }.bind(this))
    } else {

    }


};

/**
 * 处理写入队列
 * @returns {*}
 */
WorkerBase.prototype.procWritePending = function () {
    let regsToWrite = this.writeRegValues || [];
    this.writeRegValues = [];

    return async.eachSeries(regsToWrite, function (onePiece) {
        //      console.log(new Date().getTime() + "==== process :",onePiece.uuid);
        return this.writeRegValueToDevice(onePiece).then(function (result) {
            let result_flat = _.flattenDeep(result);
            this.SendExecResponse('upRegResp', onePiece.uuid, {success: true, result: (result_flat && result_flat[0])});
        }.bind(this)).catch(function (e) {
            //console.error('error in writing value:', JSON.stringify(onePiece && onePiece.target) + 'reason:' + JSON.stringify(e));
            //处理失败了，如果没有超时，就放回去准备下次处理
            if (new Date().getTime() - onePiece.time < onePiece.timeout) {
                if (this.writeRegValues.length < MAX_WRITE_CNT) {
                    this.writeRegValues.push(onePiece);
                } else {
                    this.SendExecResponse('upRegResp', onePiece.uuid, {success: false, reason: 'Pending queue full'});
                }

            } else {
                this.SendExecResponse('upRegResp', onePiece.uuid, {success: false, reason: e.message || e});
            }
        }.bind(this))
    }.bind(this));


};

WorkerBase.prototype.SendExecResponse = function (tag, uuid, result) {
    this.emit(tag+'Changed',{cmd: tag, uuid: uuid, result: result})
    SendMessage(process, {cmd: tag, uuid: uuid, result: result});
};

WorkerBase.prototype.setMessage = function (message) {
    SendMessage(process, {cmd: 'message', message});
};
WorkerBase.prototype.initDeviceId = function (devId) {

};
/*
 * 启动加入设备状态
 *
 */
WorkerBase.prototype.setInOrEx = function (option) {

};

WorkerBase.prototype.inOrEx = function (option) {
    SendMessage(process, {cmd: 'inOrEx', option});
};

WorkerBase.prototype.addDevice = function (type, uniqueId, uniqueKey) {
    SendMessage(process, {cmd: 'addDevice', type: type, uniqueId: uniqueId, uniqueKey: uniqueKey});
};

WorkerBase.prototype.ReadBI = function (mapItem, devId) {
    let error = 'ReadBI must be defined!';
    console.error(error);
    throw new error(error);
};
WorkerBase.prototype.ReadBQ = function (mapItem, devId) {
    let error = 'ReadBQ must be defined!';
    console.error(error);
    throw new error(error);
};

WorkerBase.prototype.ReadWI = function (mapItem, devId) {
    let error = 'ReadWI must be defined!';
    console.error(error);
    throw new error(error);
};
WorkerBase.prototype.ReadWQ = function (mapItem, devId) {
    let error = 'ReadWQ must be defined!';
    console.error(error);
    throw new error(error);
};
WorkerBase.prototype.WriteBQ = function (mapItem, value, devId) {
    let error = 'WriteBQ must be defined!';
    console.error(error);
    throw new error(error);
};
WorkerBase.prototype.WriteBP = function (mapItem, value, devId) {
    let error = 'WriteBP must be defined!';
    console.error(error);
    throw new error(error);
};
WorkerBase.prototype.DoWriteWQ = function (mapItem, value, devId) {
    let defer = Q.defer();
    lock(consts.STATE_LOCKER, function (release) {
        let writeEnabled = true;
        try {
            this.wqs_target[devId] = this.wqs_target[devId] || {};

            for (let i = mapItem.start; i <= mapItem.end; i++) {
                this.wqs_target[devId][i] = this.wqs_target[devId][i] || {
                        state: consts.WRITE_STATE.IDLE,
                        value: value[i],
                        state_param: 2
                    };
                this.wqs_target[devId][i].value = value[i];
                if(this.resendWQTimerHandle){
                    if (this.wqs_target[devId][i].state !== consts.WRITE_STATE.IDLE) {

                        writeEnabled = false;
                    } else {
                        this.wqs_target[devId][i].state = consts.WRITE_STATE.BUSY;
                    }
                }


            }
        } catch (e) {

        }
        release(function () {
            if (writeEnabled) {
                if(this.resendWQTimerHandle){
                    for (let i = mapItem.start; i <= mapItem.end; i++) {
                        this.wqs_target[devId][i].state = consts.WRITE_STATE.BUSY;
                        this.wqs_target[devId][i].param = 10;
                    }

                }

                this.WriteWQ(mapItem, value, devId).delay(1000).then((data)=>{
                    defer.resolve(data);
                }).catch((e)=>{
                    defer.reject(e);
                })

            }
            else {
                defer.resolve();
            }
        }.bind(this))();
    }.bind(this));

    return defer.promise;
};
WorkerBase.prototype.WriteWQ = function (mapItem, value, devId) {
    let error = 'WriteWQ must be defined!';
    console.error(error);
    throw new error(error);
};
WorkerBase.prototype.setupAutoPoll = function () {
    this.loopRun = new InfinitLoop();

    this.loopRun.addRoutine(this.WorkRoutine.bind(this), this.options.interval || 100);
}
WorkerBase.prototype.setRunningState = function (state) {
    this.runningState = state;

}
/**
 * 通知驱动，某个服务更改了
 * @param devId
 * @param memTag
 * @param memId
 */
WorkerBase.prototype.setOneMemChanged = function (devId,memTag,memId) {
    let mem_info = {}
    switch(memTag){
        case 'WQ':
            memTag = 'wq_map';
            break;
        case 'WI':
            memTag = 'wi_map';
            break;
        case 'BI':
            memTag = 'bi_map';
            break;
        case 'BQ':
            memTag = 'bq_map';
            break;
    }
    mem_info[memTag]=[{
        start:memId,
        end:memId
    }]
    this.emit('RegRead',{devId:devId,memories:mem_info});

}

WorkerBase.prototype.setMemoriesChanged = function (devId,memTag,memIds) {
    let mem_info = {}
    mem_info[memTag]={
        start:memId,
        end:memId
    }
    this.emit('RegRead',{devId:devId,memories:mem_info});

}
/**
 * 启动事件型的信息读取功能
 */
WorkerBase.prototype.setupEvent = function () {

    this.on('UpdateRegs', function () {
        this.procWritePending();
    }.bind(this));
    this.on('CallRegs', function () {
        this.procCallPending();
    }.bind(this));
    this.on('RegRead', function (regInfos) {
        if (regInfos) {
            let infectMemories = regInfos.memories;
            _.each(infectMemories, function (item, memTag) {
                if (item.hasOwnProperty('start') && item.hasOwnProperty('end')) {
                    item.len = item.end + 1 - item.start;
                }
            });
            this.procOneReadDev(regInfos.devId, infectMemories);
        }
    }.bind(this))
}
/**
 * 处理读取队列
 */
WorkerBase.prototype.procCallPending = function () {
    let that = this;
    let regsToRead = this.pendReadRegs || [];
    this.pendReadRegs = [];

    return async.eachSeries(regsToRead, function (onePiece) {
        /* uuid: msg.uuid,
         target: msg.regs,
         time: new Date(),
         timeout: msg.timeout || 2000*/
        let readInfo = {};
        _.each(onePiece.target, function (memoryId) {
            let regDef = PDUtils.splitRegDef(memoryId);
            if (regDef) {
                if (!readInfo[regDef.devId]) {
                    readInfo[regDef.devId] = {};
                }
                if (!readInfo[regDef.devId][regDef.memTag]) {
                    readInfo[regDef.devId][regDef.memTag] = [];
                }
                readInfo[regDef.devId][regDef.memTag].push(parseInt(regDef.memIndex));
            }
        });

        return async.eachSeries(_.keys(readInfo), function (devId) {
            let memory_map = {};
            _.each(_.keys(readInfo[devId]), function (memTag) {
                memory_map[memTag.toLowerCase() + "_map"] = PDUtils.CreateMapArray(_.sortBy(readInfo[devId][memTag]), that.maxSegLength, that.minGapLength);
            });
            return that.procOneReadDev(devId, memory_map);
        }).then(function () {
            let result = {};
            _.each(onePiece.target, function (regId) {
                result[regId] = that.readRegValues[regId];
            })
            that.SendExecResponse('callRegResp', onePiece.uuid, {success: true, result: result});
        }.bind(this)).catch(function (e) {
            //console.error('error in writing value:', JSON.stringify(onePiece && onePiece.target) + 'reason:' + JSON.stringify(e));
            //处理失败了，如果没有超时，就放回去准备下次处理
            if (new Date().getTime() - onePiece.time < onePiece.timeout) {
                if (that.pendReadRegs.length < MAX_WRITE_CNT) {
                    that.pendReadRegs.push(onePiece);
                } else {
                    that.SendExecResponse('callRegResp', onePiece.uuid, {success: false, reason: 'Pending queue full'});
                }

            } else {
                that.SendExecResponse('callRegResp', onePiece.uuid, {success: false, reason: e.message || e});
            }
        }.bind(this))
    }.bind(this));


};
/**
 * 读一组
 * @param readRegs
 * @returns {*}
 */
WorkerBase.prototype.procReadRegs = function (readRegs) {
    /*let reg = {
     "1": {
     "bi_map": [],
     "bq_map": [],
     "wi_map": [],
     "wq_map": [{"start": 0, "end": 1, "len": 2}, {"start": 12, "end": 14, "len": 3}, {
     "start": 15,
     "end": 16,
     "len": 2
     }]
     },
     "2": {
     "bi_map": [],
     "bq_map": [],
     "wi_map": [],
     "wq_map": [{"start": 0, "end": 1, "len": 2}, {"start": 12, "end": 14, "len": 3}, {
     "start": 15,
     "end": 16,
     "len": 2
     }]
     }
     }*/


    return async.eachSeries(Object.keys(readRegs||{}), function (devId) {
        let memories = this.autoReadMaps[devId];
        return this.procOneReadDev(devId, memories);
    }.bind(this))


};
/**
 * 读取某一个DeviceId下面的指定的memory的内容，读完之后，修改相应的寄存器
 * @param devId
 * @param memories
 * @returns {Promise.<TResult>}
 */
WorkerBase.prototype.procOneReadDev = function (devId, memories) {
    let modified_regs = [];
    let that = this;
    /* memories: {
     "bi_map": [],
     "bq_map": [],
     "wi_map": [],
     "wq_map": [{"start": 0, "end": 1, "len": 2}, {"start": 12, "end": 14, "len": 3}, {
     "start": 15,
     "end": 16,
     "len": 2
     }]
     }*/

    function checkAndSetBitRegs(tag, devId, bi_mapItem, newData) {
        for (let i = 0; i < (bi_mapItem.len || (bi_mapItem.end+1-bi_mapItem.start)); i++) {
            let regName = devId + ":" + tag + "." + (bi_mapItem.start + i);
            let boolValue = (newData[i] ? true : false);

            if (that.readRegValues[regName] != boolValue) {
                that.readRegValues[regName] = boolValue;
                modified_regs.push(regName);
            }
        }
    }

    function checkAndSetWordRegs(tag, devId, bi_mapItem, newData) {
        newData = newData || {};
        for (let i = 0; i < (bi_mapItem.len || (bi_mapItem.end+1-bi_mapItem.start)); i++) {
            let regName = devId + ":" + tag + "." + (bi_mapItem.start + i);

            let value = newData[i];
            if (that.readRegValues[regName] != value) {
                that.readRegValues[regName] = value;
                modified_regs.push(regName);
            }
        }
    }

    if (this.runningState == this.RUNNING_STATE.CONNECTED) {


        this.initDeviceId(devId);
        return Q.delay((this.options && this.options.inter_device) || 10).then(function () {
            return async.eachSeries(memories.bi_map || [], function (bi_mapItem) {
                return Q().then(function () {
                    return that.ReadBI(bi_mapItem, devId);
                }).then(function (data) {
                    //console.log('bi:', JSON.stringify(data));
                    checkAndSetBitRegs('BI', devId, bi_mapItem, data);
                });
            })
        }).then(function () {
            return async.eachSeries(memories.bq_map || [], function (bi_mapItem) {
                return Q().then(function () {
                    return that.ReadBQ(bi_mapItem, devId);
                }).then(function (data) {
                    //console.log('bq:',JSON.stringify(data));
                    checkAndSetBitRegs('BQ', devId, bi_mapItem, data);
                });
            });
        }.bind(this)).then(function () {
            return async.eachSeries(memories.wi_map || [], function (bi_mapItem) {
                //  console.log(new Date().getTime() + ' read map:',JSON.stringify(bi_mapItem));
                return Q().then(function () {
                    return that.ReadWI(bi_mapItem, devId);
                }).then(function (data) {
                    //console.log('wi:',JSON.stringify(data));
                    checkAndSetWordRegs('WI', devId, bi_mapItem, data);
                }).catch(function (e) {
                    console.log(new Date().getTime() + ' error:' + e);
                });
            });
        }.bind(this)).then(function () {
            return async.eachSeries(memories.wq_map || [], function (bi_mapItem) {
                //  console.log(new Date().getTime() +":"+devId+ ': read map:',JSON.stringify(bi_mapItem));
                return Q().then(function () {
                    return that.ReadWQ(bi_mapItem, devId);
                }).then(function (data) {
                   // console.log('wq:',JSON.stringify(data));
                    checkAndSetWordRegs('WQ', devId, bi_mapItem, data);
                  //  console.log('modified:', modified_regs);
                }).catch(function (e) {
                    console.log(new Date().getTime() + ' error:' + e);
                });

            });
        }.bind(this)).then(function () {

            this.OnRegModified(modified_regs);
        }.bind(this));
    } else {
        return Q.delay(500).then(function () {
            return Q.reject('not in running state');
        });
    }
}
/**
 * 基本的轮询工作 过程，如果设置成event类型，那么就不会被调用
 * @returns {Promise.<TResult>}
 * @constructor
 */
WorkerBase.prototype.WorkRoutine = function () {
    let that = this;


    return this.procWritePending().then(function () {
        return this.procCallPending();
    }.bind(this)).then(function () {
        return this.procReadRegs(this.autoReadMaps || {});
    }.bind(this)).catch((e)=>{
        console.error('error',e.message||e);
    });
};

WorkerBase.release = function () {
    if (this.resendWQTimerHandle) {
        clearInterval(this.resendWQTimerHandle);
        this.resendWQTimerHandle = null;
    }
    if (this.presetReadHandle) {
        clearInterval(this.presetReadHandle);
        this.presetReadHandle = null;
    }
};
WorkerBase.prototype.setupPredefineReadInterval = function () {
    let self = this;
    if (this.presetReadHandle) {
        clearInterval(this.presetReadHandle);
        this.presetReadHandle = null;
    }
    this.presetReadHandle = setInterval(function () {
        _.each(this.PresetAutoreadRegs, function (wqs, devId) {
            _.each(wqs, function (value, wq) {
                if (value.interval) {
                    if (value.remain > 0) {
                        value.remain--;
                        if (value.remain === 0) {
                            value.remain = value.interval;

                            if (!value.matched) {
                                value.matched = true;
                                let target = [];
                                target.push(devId + ":WQ." + wq);
                                self.pendReadRegs.push({

                                    target: target,
                                    time: new Date(),
                                    timeout: 2000
                                });

//                                console.log(`new action: ${devId}.${wq}`);
                            }
                        } else {
                            value.matched = false;
                        }
                    }
                } else if (value.matcher) {
                    if (value.matcher()) {
                        if (!value.matched) {
                            value.matched = true;
                            let target = [];
                            target.push(devId + ":WQ." + wq);
                            // console.log(`new action: ${devId}.${wq}`);
                            self.pendReadRegs.push({

                                target: target,
                                time: new Date(),
                                timeout: 2000
                            });
                        }

                    } else {
                        value.matched = false;
                    }
                }
            })
        })
    }.bind(this), 1000);
};
WorkerBase.prototype.setupAsyncWQTimer = function (resendTimer) {
    this.resendWQTimer = resendTimer;

    let self = this;
    if (!resendTimer) {
        if (this.resendWQTimerHandle) {
            clearInterval(this.resendWQTimer);
        }
    } else {
        this.resendWQTimerHandle = setInterval(function () {
            lock(consts.STATE_LOCKER, function (release) {
                _.each(this.wqs_target, function (wqs, deviceId) {
                    _.each(wqs, function (wq, wqid) {
                        if (wq && wq.value !== undefined) {

                            try {
                                if (wq.state === consts.WRITE_STATE.FAILED) {

                                    if (!(self.wqs_latch && self.wqs_latch[deviceId] && _.isEqual(self.wqs_latch[deviceId][wqid], wq.value))) {
                                        let value = {};
                                        value[wqid] = wq.value;

                                        console.log(`resend data:${deviceId}.${wqid}:${JSON.stringify(value)}`)
                                        //恢复重发
                                        wq.state = consts.WRITE_STATE.BUSY; //当前为忙，
                                        //console.log(new Date() + `***state changed ${deviceId}:${wq} state:${wq.state}`)
                                        self.WriteWQ({start: wqid, end: wqid}, value, deviceId);
                                    }
                                    /*else if(self.wqs_latch && self.wqs_latch[deviceId] && _.isEqual(self.wqs_latch[deviceId][wqid], wq.value)){
                                     wq.state = consts.WRITE_STATE.IDLE;
                                     }*/
                                } else if (wq.state === consts.WRITE_STATE.PENDING) {
                                    wq.state = consts.WRITE_STATE.FAILED; //准备下次重发
                                    //console.log(new Date() + `***state changed ${deviceId}:${wq} state:${wq.state}`)
                                } else if (wq.state === consts.WRITE_STATE.BUSY) {
                                    if (wq.state_param > 0) {
                                        wq.state_param--;
                                        if (wq.state_param === 0) {
                                            wq.state = consts.WRITE_STATE.FAILED;
                                        }
                                    } else {
                                        wq.state_param = 2;
                                    }

                                    //console.log(new Date() + `***state changed ${deviceId}:${wq} state:${wq.state}`)
                                } else if (wq.state === consts.WRITE_STATE.CONFIRM) {
                                    if (wq.state_param > 0) {
                                        wq.state_param--;
                                        if (wq.state_param === 0) {
                                            wq.state = consts.WRITE_STATE.FAILED;
                                        }
                                    } else {
                                        wq.state_param = 2;
                                    }
                                }
                            } catch (e) {

                            }

                        }
                    });
                })
                release(function () {
                })();
            }.bind(this));
        }.bind(this), resendTimer);
    }
};
WorkerBase.prototype.updateWriteState = function (deviceId, wq, newState, param) {
    lock(consts.STATE_LOCKER, function (release) {
        try {
            if (this.wqs_target && this.wqs_target[deviceId]) {
                //console.log(new Date() + `***state changed ${deviceId}:${wq} state:${newState}`)
                this.wqs_target[deviceId][wq] = this.wqs_target[deviceId][wq] || {};
                this.wqs_target[deviceId][wq].state = newState;
                this.wqs_target[deviceId][wq].state_param = param;
            }
        } catch (e) {

        }
        release(function () {
        })();
    }.bind(this));
}
/*WorkerBase.prototype.resetWriteState = function (deviceId, wq) {
 if (this.wqs_target && this.wqs_target[deviceId]) {
 this.wqs_target[deviceId][wq] = this.wqs_target[deviceId][wq] || {};
 this.wqs_target[deviceId][wq].state = consts.WRITE_STATE.PENDING;
 }
 };
 WorkerBase.prototype.updateWqsValue = function (deviceId, wq, value) {
 this.wqs_latch = this.wqs_latch || {};
 this.wqs_latch[deviceId] = this.wqs_latch[deviceId] || {};
 this.wqs_latch[deviceId][wq] = value;
 };*/
WorkerBase.prototype.writeRegValueToDevice = function (onePiece) {

    let that = this;
    if (this.runningState === this.RUNNING_STATE.CONNECTED) {
        let time_elasp = new Date().getTime() - onePiece.time;
        if (time_elasp <= onePiece.timeout) {
            let segToWrite = onePiece.target;
            if (segToWrite) {
               /// console.log('...',JSON.stringify(segToWrite));
                //segToWrite的形式： segToWrite[regDef.devId][regDef.memTag][regDef.memIndex]= regValue;
                return async.eachSeries(_.keys(segToWrite), function (devId) {
                    let memories = segToWrite[devId];
                    return async.eachSeries(_.keys(memories), function (memTag) {
                        let memValues = memories[memTag];
                        let writeArrays = PDUtils.CreateWritePackedArray(Object.keys(memValues));

                        return async.eachSeries(writeArrays, function (onePack) {
                            if (memTag === 'BQ') { //写多个线圈
                                return that.WriteBQ(onePack, segToWrite[devId][memTag], devId);
                            }
                            else if (memTag === 'BP') { //写多个线圈
                                return that.WriteBP(onePack, segToWrite[devId][memTag], devId);
                            }
                            else if (memTag === 'WQ') {  //写多个寄存器
                                return that.DoWriteWQ(onePack, segToWrite[devId][memTag], devId);
                            }
                        })
                    })
                })


            }
        } else {
            return Q.reject('timeout ');
        }
    } else {
        return Q.delay(500).then(function () {
            return Q.reject('not in running state');
        });
    }

};
/**
 * 针对每一个mapItem的项，调用一次regReader，具有一个参数( reg)，代表所要读取的寄存器， 返回读取的值即可
 * @param mapItem  数据项
 * @param regReader ( reg)
 * @returns {Promise.<TResult>}
 * @constructor
 */
WorkerBase.prototype.CreateWQReader = function (mapItem, regReader) {


    let regs = [];
    for (let i = mapItem.start; i <= mapItem.end; i++) {
        regs.push(i);
    }

    return async.eachSeries(regs, function (reg) {
        return regReader.call(this, reg);
    }.bind(this)).then(function (results) {
        return results;
    })
}
/**
 * 这是一个辅助函数
 * 针对每一个mapItem的项，调用一次regReader，具有两个参数( reg,regValue)， reg是要写入的寄存器号，regValue是要写入的值
 * @param mapItem  数据项
 * @param regReader ( reg,results)
 * @returns {Promise.<TResult>}
 * @constructor
 */
WorkerBase.prototype.CreateWQWriter = function (mapItem, values, regWriter) {

    let regs = [];
    for (let i = mapItem.start; i <= mapItem.end; i++) {
        regs.push(i);
    }
    return async.eachSeries(regs, function (reg) {
        return regWriter.call(this, reg, values[reg]);
    }.bind(this)).then(function (results) {
        return results;
    })
};
module.exports = WorkerBase;


