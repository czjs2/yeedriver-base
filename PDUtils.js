/**
 * Created by zhuqizhong on 16-12-3.
 */

const _ = require('lodash');
const memoryKeys = ["BI","BQ","BP","WI","WQ"];
/**
 * 把一串配置信息变成寄存器事情的数组
 * @param cfgString 配置的id信息 如"1-10,15,16"这种类型
 * @returns {Array} 分析得到的数组，[1,2,3,4,5,6,7,8,9,10,15,16]
 * @constructor
 */
function CfgStringParser(cfgString){
    //分割，并且去掉空的。
    var regs = _.compact(cfgString && cfgString.split(/[,\s]/));
    var result = [];
    _.each(regs,function(reg){
        var se_def = reg.split(/-/);
        if(se_def.length == 1){
            result.push(parseInt(se_def[0]));
        }else if(se_def.length == 2){
            for(var i = parseInt(se_def[0]); i <= parseInt(se_def[1]);i++){
                result.push(i);
            }
        }
    });

    result = _.sortBy(result);
    return result;
}

/**
 * 记录一个array里各个元素的个数，array还没有合并数据
 * @param anArray
 * @constructor
 */
function ArrayCalc(anArray){
    var retArray={};
    _.each(anArray,function(value){
        if(!retArray[value]){
            retArray[value] = 1;
        }else{
            retArray[value]++;
        }
    })
    return retArray;
}

/**
 * 根据配置的id信息，生成一组可以同时读写的片断
 * @param orgArrayInfo  需要的寄存器列表，已经排好序了
 * @param maxSegLength  每一个片断最大的寄存器的长度
 * @param minGapLength  相邻两个超过多少的，就切割成两个片断
 * @constructor
 */
function GetMapArray(orgArrayInfo,maxSegLength,minGapLength){
    maxSegLength = maxSegLength || 64;
    minGapLength = minGapLength || 16;

    var result=[];
    if(orgArrayInfo.length > 1){

        var start = orgArrayInfo[0];
        var end =orgArrayInfo[0];

        for(var i = 1 ; i < orgArrayInfo.length;i++){
            if(orgArrayInfo[i] - start >= maxSegLength
                || orgArrayInfo[i] - orgArrayInfo[i-1] >= minGapLength
            ){

                var newItem ={};
                newItem.start = start;
                newItem.end = orgArrayInfo[i-1];
                newItem.len = newItem.end + 1 - start;
                result.push(newItem);
                start = orgArrayInfo[i];
                end = orgArrayInfo[i];

            }
            if( i == orgArrayInfo.length-1){
                var newItem ={};
                newItem.start = start;
                newItem.end = orgArrayInfo[i];
                newItem.len = newItem.end + 1 - start;
                result.push(newItem);
            }
        }
    }else if(orgArrayInfo.length == 1){

        var newItem ={};
        newItem.start =  orgArrayInfo[0];
        newItem.end = orgArrayInfo[0];
        newItem.len = 1;
        result.push(newItem);
    }
    return result;

}

function ParseMemories (memories){
    var parsedMemory = {};
    _.each(memories,function(memoryItem,memoryId){
        var memoryInfo =
        {
            BI:CfgStringParser(memoryItem.BI || ""),
            BQ:CfgStringParser(memoryItem.BQ || ""),
            BP:CfgStringParser(memoryItem.BP || ""),
            WI:CfgStringParser(memoryItem.WI || ""),
            WQ:CfgStringParser(memoryItem.WQ || "")
        };

        memoryInfo.BI_INFO = ArrayCalc(memoryInfo.BI);
        memoryInfo.BQ_INFO = ArrayCalc(memoryInfo.BQ);
        memoryInfo.BP_INFO = ArrayCalc(memoryInfo.BP);
        memoryInfo.WI_INFO = ArrayCalc(memoryInfo.WI);
        memoryInfo.WQ_INFO = ArrayCalc(memoryInfo.WQ);

        parsedMemory[memoryId] = memoryInfo;
    });


    return parsedMemory;

}

/**
 * 添加一个内存信息
 * @param oldMemories
 * @param memoriesDef
 * @param infoIsParsed memoriesDef中的内容是否已经分解好
 * @constructor
 */
function AddToMemories (originMemories,memoriesInfo,infoIsParsed){
    _.each(memoriesInfo,function(memoriesDef,memoryItem){
        var oldMemories = originMemories[memoryItem] || {};
        var newMemories =   infoIsParsed?memoriesDef:
            {
                BI:CfgStringParser(memoriesDef.BI || ""),
                BQ:CfgStringParser(memoriesDef.BQ || ""),
                BP:CfgStringParser(memoriesDef.BP || ""),
                WI:CfgStringParser(memoriesDef.WI || ""),
                WQ:CfgStringParser(memoriesDef.WQ || "")
            };

        _.each(newMemories,(item,key)=>{
            _.each(item,(regNum)=>{
                let infoKey = key+'_INFO';
                if(!oldMemories[infoKey]){
                    oldMemories[infoKey] = {};
                }
                if(!oldMemories[key]){
                    oldMemories[key] = [];
                }

                if(oldMemories[infoKey][regNum]){
                    oldMemories[infoKey][regNum]++;
                }else{
                    oldMemories[infoKey][regNum] = 1;
                    oldMemories[key].push(regNum);
                }
            });
        });

        _.each(memoryKeys,(key)=>{
            oldMemories[key] = _.sortBy( oldMemories[key]);
        });

        // _.each(newMemories.BI,function(regNum){
        //     if(!oldMemories.BI_INFO){
        //         oldMemories.BI_INFO = {};
        //     }
        //     if(!oldMemories.BI){
        //         oldMemories.BI = [];
        //     }
        //
        //     if(oldMemories.BI_INFO[regNum]){
        //         oldMemories.BI_INFO[regNum]++;
        //     }else{
        //         oldMemories.BI_INFO[regNum] = 1;
        //         oldMemories.BI.push(regNum);
        //     }
        // });
        //
        // _.each(newMemories.BQ,function(regNum){
        //     if(!oldMemories.BQ_INFO){
        //         oldMemories.BQ_INFO = {};
        //     }
        //     if(!oldMemories.BQ){
        //         oldMemories.BQ = [];
        //     }
        //     if(oldMemories.BQ_INFO[regNum]){
        //         oldMemories.BQ_INFO[regNum]++;
        //     }else{
        //         oldMemories.BQ_INFO[regNum] = 1;
        //         oldMemories.BQ.push(regNum);
        //     }
        // });
        // _.each(newMemories.WI,function(regNum){
        //     if(!oldMemories.WI_INFO){
        //         oldMemories.WI_INFO = {};
        //     }
        //     if(!oldMemories.WI){
        //         oldMemories.WI = [];
        //     }
        //     if(oldMemories.WI_INFO[regNum]){
        //         oldMemories.WI_INFO[regNum]++;
        //     }else{
        //         oldMemories.WI_INFO[regNum] = 1;
        //         oldMemories.WI.push(regNum);
        //     }
        // });
        // _.each(newMemories.WQ,function(regNum){
        //     if(!oldMemories.WQ_INFO){
        //         oldMemories.WQ_INFO = {};
        //     }
        //     if(!oldMemories.WQ){
        //         oldMemories.WQ = [];
        //     }
        //     if(oldMemories.WQ_INFO[regNum]){
        //         oldMemories.WQ_INFO[regNum]++;
        //     }else{
        //         oldMemories.WQ_INFO[regNum] = 1;
        //         oldMemories.WQ.push(regNum);
        //     }
        // });
        //
        // oldMemories.BI = _.sortBy( oldMemories.BI);
        // oldMemories.BQ = _.sortBy( oldMemories.BQ);
        // oldMemories.WI = _.sortBy( oldMemories.WI);
        // oldMemories.WQ = _.sortBy( oldMemories.WQ);
        originMemories[memoryItem] = oldMemories;
    })


}
/**
 *
 * @param originMemories
 * @param memoriesInfo
 */
function delFromMemories(originMemories,memoriesInfo,infoIsParsed){
    _.each(memoriesInfo,function(memoriesDef,memoryItem) {
        var oldMemories = originMemories[memoryItem] || {};
        var newMemories = infoIsParsed?memoriesDef:
            {
                BI:CfgStringParser(memoriesDef.BI || ""),
                BQ:CfgStringParser(memoriesDef.BQ || ""),
                BP:CfgStringParser(memoriesDef.BP || ""),
                WI:CfgStringParser(memoriesDef.WI || ""),
                WQ:CfgStringParser(memoriesDef.WQ || "")
            };

        _.each(memoryKeys,(key)=>{
            let remove = [];
            let infoKey = key+'_INFO';
            _.each(newMemories[key], (regNum)=> {
                if (oldMemories[infoKey][regNum] > 1) {
                    oldMemories[infoKey][regNum]--;
                } else {
                    delete oldMemories[infoKey][regNum];
                    remove.push(regNum);
                }
            });
            oldMemories[key] = _.sortBy(_.difference(oldMemories[key], remove));

        });

            // var bi_remove = [];
            // _.each(newMemories.BI, function (regNum) {
            //     if (oldMemories.BI_INFO[regNum] > 1) {
            //         oldMemories.BI_INFO[regNum]--;
            //     } else {
            //         delete oldMemories.BI_INFO[regNum];
            //         bi_remove.push(regNum);
            //     }
            // });
            // oldMemories.BI = _.sortBy(_.difference(oldMemories.BI, bi_remove));
            //
            // var bq_remove = [];
            // _.each(newMemories.BQ, function (regNum) {
            //     if (oldMemories.BQ_INFO[regNum] > 1) {
            //         oldMemories.BQ_INFO[regNum]--;
            //     } else {
            //         delete oldMemories.BQ_INFO[regNum];
            //         bq_remove.push(regNum);
            //     }
            // });
            // oldMemories.BQ = _.sortBy(_.difference(oldMemories.BQ, bq_remove));
            //
            // var wi_remove = [];
            // _.each(newMemories.WI, function (regNum) {
            //     if (oldMemories.WI_INFO[regNum] > 1) {
            //         oldMemories.WI_INFO[regNum]--;
            //     } else {
            //         delete oldMemories.WI_INFO[regNum];
            //         wi_remove.push(regNum);
            //     }
            // });
            // oldMemories.WI = _.sortBy(_.difference(oldMemories.WI, wi_remove));
            //
            // var wq_remove = [];
            // _.each(newMemories.WQ, function (regNum) {
            //     if (oldMemories.WQ_INFO[regNum] > 1) {
            //         oldMemories.WQ_INFO[regNum]--;
            //     } else {
            //         delete oldMemories.WQ_INFO[regNum];
            //         wq_remove.push(regNum);
            //     }
            // });
            // oldMemories.WQ = _.sortBy(_.difference(oldMemories.WQ, wq_remove));


    });
}
/**
 * 生成要写入的数据寄存器序列，把需要写入的连续寄存器放到一起
 * @param writeRegInfos
 * @constructor
 */
function CreateWritePackedArray(writeRegInfosArray){
    var result = [];
    if(writeRegInfosArray.length > 0){
        var start = parseInt(writeRegInfosArray[0]);
        if(writeRegInfosArray.length > 1){
            for(var i= 1; i < writeRegInfosArray.length; i++){
                if(writeRegInfosArray[i] - writeRegInfosArray[i-1] > 1){
                    //截断
                    var end=parseInt(writeRegInfosArray[i-1]);
                    result.push({start:start,end:end});
                    start = parseInt(writeRegInfosArray[i]);
                }
                if(writeRegInfosArray.length -1 == i){
                    //截断
                    var end=parseInt(writeRegInfosArray[i]);
                    result.push({start:start,end:end});
                }
            }
        }else{
            end = start;
            result.push({start:start,end:end});
        }

    }
    return result;


}
/**
 * 把一个ID1:BI.1 的寄存器id分解成地址/ tag 和寄存器号的形式
 * @param regId
 * @returns {*}
 */
function splitRegDef (regId){
    var result;
    var withAddress = regId.split(/:/);
    if(withAddress.length > 1 && withAddress[0] && withAddress[1] ) {
        var dev_id = withAddress[0];


        var segAndNum = withAddress[1] && withAddress[1].split(/\./);
        if(segAndNum.length > 1 && segAndNum[0] && segAndNum[1]){
            var segInfo =  segAndNum[0].toUpperCase();
            var segValue =  parseInt(segAndNum[1]);
            result = {
                devId:dev_id,
                memTag:segInfo,
                memIndex:segValue
            }
        }
    }
    return result;
}
module.exports.ParseRegs = CfgStringParser;
module.exports.ConcatMemories = AddToMemories;
module.exports.RemoveMemories = delFromMemories;
module.exports.ParseMemories = ParseMemories;
module.exports.CreateMapArray = GetMapArray;
module.exports.CreateWritePackedArray = CreateWritePackedArray;
module.exports.splitRegDef = splitRegDef;