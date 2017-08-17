# yeedriver-base
yeedriver-base
## 自动重发功能的实现 
在autoPoll模式下，writeWQ是同步的，如果返回成功，就不再重发，否则就会不断重发

在事件模式下，需要用另外一种方式处理：

1.每个workerBase的继承类，会有两个对象：

  做一个wqs_latch，该值记录各个devId下的wq所对应的值，该值应该来自于设备，至于如何从设备获取，由实现者定义 

 驱动在写入的时候，会做一个wqs_target，该值会记录实际需要写入的值，该值由系统维护

workerBase的继承类，通过setAsyncWQTimer来设置需要重发的定时器间隔

系统驱动根据定时器，对比wqs_target和wqs_latch里的值，如果一致，则跳过，如果不一致，就会启动相应的WriteWQ进行重发

需要注意的是writeWQ是并发进行的，同时又被定时器触发（需要重发的时候），因此，有可能在某个wq正在被写入的时候，wq又触发了。为了避免这种情况，在wqs_target里，设置两项，一个是值(value)，一个是状态(state)，状态有两种，busy和idle。驱动定时器在发现状态是busy的时候，就跳过这一次的重写，只有当检查的时候是idle的时候，才可能进行重写。

    写状态定义

  

this.WRITE_WTATE= {

    'IDLE':0,

    'BUSY':1,

     'FAILED':3

     'PENDING':4

}

   IDLE --  要求写入 --> BUSY --写入完毕--> 确认写入成功

                                               如果目前和写入的一致--> IDLE

                                               如果目标和写入的变化了--> PENDING

                                      --> 写入失败      FAILED




 

因此，驱动在实现写动作的时候，需要做以下事情：

    实现writeWQ，来实现实际的数据写入(驱动已经把wqs_target的内容填充好了，不用再考虑的）

    在合适的时间点上修改wqs_target里的state值为idle

    在合适的时候，更新wqs的状态

workerBase提供一个工具函数实现：

更新wq的状态:
updateWqState(deviceId,ep,newState)

workerBase有一个定时器，每隔2秒查询一次所有的wq的状态

如果是FAILED，就进行一次重发

如果是PENDING，就修改成FAILED


另外，驱动在实现读动作的时候，按以下的方式进行

  1.驱动实现ReadWQ

  2.驱动在确认数据变化的时候，产生一个RegRead的事件。 其数据内容格式如下：

const memories= {devId:devId,memories:{wq_map:[{start:wq,end:wq,len:1}]}};

this.evtMaster.emit('RegRead',memories);

另外，驱动 在初始化的时候，别忘记配置

this.setRunningState(this.RUNNING_STATE.CONNECTED); //设置成运行中，允许数据收发

this.setupEvent();//设置成事件模式 

this.setupAsyncWQTimer(2000); //打开重发

如果本身不需要重发的，或者发送有回应本身就不一致的，如发送访客机查询一个访客记录等这种数据，通过setupAsyncWQTimer(0)来关闭重发，或者不调用setupAsyncWQTimer，因为默认是不重发的。
## 自动读取的数据模式
在autoPoll模式下，为了避免大量的无效数据召测，驱动可以设置自动读取功能，实现针对某些数据的自动定时读取，同时可以对不同的数据点进行不同间隔的读取

