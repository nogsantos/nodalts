import { Model } from './model';
import { ModelArray } from './model-array';
import { ItemArray } from './item-array';
/**
 * 
 */
export class Api {
    /**
     * 
     */
    format(obj: any, arrayInterface: any, userResource?: any) {
        if (obj instanceof Error) {
            return this.error(obj.message, obj.details);
        }
        if (obj instanceof Model) {
            let modelArray = new ModelArray(obj.constructor);
            modelArray.setMeta({ total: 1, offset: 0 });
            modelArray.push(obj);
            obj = modelArray;
        }
        if (!(obj instanceof ItemArray)) {
            return this.spoof(obj);
        }
        return this.response(obj, arrayInterface);
    }
    /**
     * 
     */
    meta(total: number, count: number, offset: number, error?: any, summary?: any, resource?: any) {
        if (error) {
            total = 0;
            count = 0;
            offset = 0;
            resource = null;
        }
        let meta: any = {
            total: total,
            count: count,
            offset: offset,
            error: error
        };
        summary && (meta.summary = summary);
        resource && (meta.resource = resource);
        return meta;
    }
    /**
     * 
     */
    error(message: string, details: string) {
        return {
            meta: this.meta(0, 0, 0, { message: message, details: details }),
            data: []
        };
    }
    /**
     * 
     */
    spoof(obj: any, useResource?: any) {
        if (!(obj instanceof Array)) {
            obj = [obj];
        }
        return {
            meta: this.meta(
                obj.length,
                obj.length,
                0,
                null,
                null,
                useResource && this.resourceFromArray(obj)
            ),
            data: obj
        }
    }
    /**
     * 
     */
    response(itemArray: ItemArray, arrInterface: any, useResource?: any) {
        return {
            meta: this.meta(
                itemArray._meta.total,
                itemArray.length,
                itemArray._meta.offset,
                null,
                null,
                useResource && this.resourceFromModelArray(itemArray, arrInterface)
            ),
            data: itemArray.toObject(arrInterface)
        }
    }
    /**
     * 
     */
    resourceFromArray(arr: Array<any>) {
        let fields = [];
        if (arr.length && arr[0] && typeof arr[0] === 'object') {
            let datum = arr[0];
            fields = Object.keys(datum).map((v: any, i) => {
                return {
                    name: v,
                    type: this.getType(datum[v]),
                    array: (v instanceof Array)
                }
            });
        }
        return {
            name: 'object',
            fields: fields
        }
    }
    private getType(v: Array<any>) {
        v = (v instanceof Array) ? v[0] : v;
        return {
            'boolean': 'boolean',
            'string': 'string',
            'number': 'float'
        }[(typeof v)] || ((v instanceof Date) ? 'datetime' : 'string');
    };
    /**
     * 
     */
    resourceFromModelArray(modelArray, arrInterface) {
        return modelArray._modelConstructor.toResource(arrInterface);
    }
}