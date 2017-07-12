/**
 * Created by zhuqizhong on 17-6-5.
 */
module.exports = {
    WRITE_STATE: {
        'IDLE': 0,   //当前空闲
        'BUSY': 1,   //数据正在发送中
        'PENDING': 2,  //数据发送完毕，但是回应的状态不一致，需要重发，等待workerBase下一次重发
        'FAILED': 3,   //数据发送失败，这一次要重发
        'CONFIRM':4
    },
    STATE_LOCKER:"STATE_LOCKER"
}